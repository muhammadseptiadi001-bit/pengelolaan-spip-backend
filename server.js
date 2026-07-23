require('dotenv').config()
console.log("CEK DATABASE_URL:", process.env.DATABASE_URL)
const express = require('express')
const cors = require('cors')
const { Pool } = require('pg')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const nodemailer = require('nodemailer')
const cron = require('node-cron')

const app = express()
const PORT = process.env.PORT || 3000
const SECRET_KEY = "spip-rahasia-ganti-nanti-produksi"

app.use(cors())
app.use(express.json({ limit: '20mb' }))

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

async function setupDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      nama TEXT,
      username TEXT UNIQUE,
      email TEXT,
      password TEXT
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS unit (
      id SERIAL PRIMARY KEY,
      "namaPerusahaan" TEXT,
      "jenisSpip" TEXT,
      "namaUnit" TEXT,
      "jenisAlat" TEXT,
      "nomorUnit" TEXT,
      "tanggalUjiTerakhir" TEXT,
      "jangkaWaktuBulan" INTEGER,
      "statusKelayakan" TEXT,
      temuan TEXT,
      "tindakLanjut" TEXT,
      foto TEXT,
      "pdfNama" TEXT,
      "pdfData" TEXT,
      "dibuatOleh" TEXT
    )
  `)

  console.log("Database siap.")
}
setupDatabase()

// ===== MIDDLEWARE AUTENTIKASI =====

function verifikasiToken(req, res, next) {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Akses ditolak. Silakan login terlebih dahulu." })
  }

  const token = authHeader.split(" ")[1]

  try {
    const decoded = jwt.verify(token, SECRET_KEY)
    req.user = decoded
    next()
  } catch (err) {
    return res.status(401).json({ error: "Sesi login tidak valid atau sudah kedaluwarsa. Silakan login ulang." })
  }
}

// ===== EMAIL SETUP =====

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
})

function hitungSisaHari(tanggalUjiTerakhir, jangkaWaktuBulan) {
  const jatuhTempo = new Date(tanggalUjiTerakhir)
  jatuhTempo.setMonth(jatuhTempo.getMonth() + Number(jangkaWaktuBulan))
  const sekarang = new Date()
  return Math.floor((jatuhTempo - sekarang) / (1000 * 60 * 60 * 24))
}

async function kirimNotifikasiJatuhTempo() {
  const { rows: semuaUnit } = await pool.query('SELECT * FROM unit')
  const { rows: semuaUser } = await pool.query("SELECT * FROM users WHERE email IS NOT NULL AND email != ''")

  const unitPerluDiperhatikan = semuaUnit.filter((unit) => {
    const sisaHari = hitungSisaHari(unit.tanggalUjiTerakhir, unit.jangkaWaktuBulan)
    return sisaHari <= 30
  })

  if (unitPerluDiperhatikan.length === 0) {
    return { terkirim: 0, pesan: "Tidak ada unit yang mendekati/lewat jatuh tempo." }
  }
  if (semuaUser.length === 0) {
    return { terkirim: 0, pesan: "Belum ada user dengan email terdaftar." }
  }

  const daftarHtml = unitPerluDiperhatikan.map((unit) => {
    const sisaHari = hitungSisaHari(unit.tanggalUjiTerakhir, unit.jangkaWaktuBulan)
    const status = sisaHari < 0 ? "SUDAH LEWAT TEMPO" : `${sisaHari} hari lagi`
    return `<li><b>${unit.namaUnit} (${unit.nomorUnit})</b> - ${unit.namaPerusahaan} — ${status}</li>`
  }).join("")

  const htmlEmail = `
    <h2>Peringatan Jatuh Tempo Uji Kelayakan SPIP</h2>
    <p>Berikut unit yang mendekati atau sudah melewati jatuh tempo uji kelayakan:</p>
    <ul>${daftarHtml}</ul>
    <p>Silakan buka aplikasi Pengelolaan SPIP untuk detail lebih lanjut.</p>
  `

  let terkirim = 0
  for (const user of semuaUser) {
    try {
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: user.email,
        subject: `⚠️ Peringatan: ${unitPerluDiperhatikan.length} Unit Mendekati/Lewat Jatuh Tempo`,
        html: htmlEmail,
      })
      terkirim++
    } catch (err) {
      console.error(`Gagal kirim email ke ${user.email}:`, err.message)
    }
  }

  return { terkirim, pesan: `Email berhasil dikirim ke ${terkirim} dari ${semuaUser.length} user.` }
}

cron.schedule('0 8 * * *', () => {
  console.log("Menjalankan pengecekan notifikasi terjadwal...")
  kirimNotifikasiJatuhTempo()
}, {
  timezone: "Asia/Jakarta"
})

app.post('/api/kirim-notifikasi', verifikasiToken, async (req, res) => {
  try {
    const hasil = await kirimNotifikasiJatuhTempo()
    res.json(hasil)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Gagal mengirim notifikasi: " + err.message })
  }
})

// ===== AUTH =====

app.post('/api/register', async (req, res) => {
  const { nama, username, email, password } = req.body

  if (!nama || !username || !email || !password) {
    return res.status(400).json({ error: "Semua kolom wajib diisi" })
  }

  try {
    const { rows: userAda } = await pool.query('SELECT * FROM users WHERE username = $1', [username])
    if (userAda.length > 0) {
      return res.status(400).json({ error: "Username sudah dipakai" })
    }

    const passwordHash = bcrypt.hashSync(password, 10)
    const { rows } = await pool.query(
      'INSERT INTO users (nama, username, email, password) VALUES ($1, $2, $3, $4) RETURNING id, nama, username, email',
      [nama, username, email, passwordHash]
    )
    res.json(rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Gagal mendaftar: " + err.message })
  }
})

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body

  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username])
    const user = rows[0]
    if (!user) {
      return res.status(400).json({ error: "Username atau password salah" })
    }

    const cocok = bcrypt.compareSync(password, user.password)
    if (!cocok) {
      return res.status(400).json({ error: "Username atau password salah" })
    }

    const token = jwt.sign({ id: user.id, nama: user.nama, username: user.username }, SECRET_KEY, { expiresIn: "7d" })
    res.json({ token, user: { id: user.id, nama: user.nama, username: user.username, email: user.email } })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Gagal login: " + err.message })
  }
})

// ===== UNIT SPIP (semua endpoint di bawah ini wajib login) =====

app.get('/api/unit', verifikasiToken, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM unit')
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Gagal mengambil data: " + err.message })
  }
})

app.post('/api/unit', verifikasiToken, async (req, res) => {
  const {
    namaPerusahaan, jenisSpip, namaUnit, jenisAlat, nomorUnit,
    tanggalUjiTerakhir, jangkaWaktuBulan, statusKelayakan, temuan, tindakLanjut, foto,
    pdfNama, pdfData, dibuatOleh
  } = req.body

  try {
    const { rows } = await pool.query(
      `INSERT INTO unit (
        "namaPerusahaan", "jenisSpip", "namaUnit", "jenisAlat", "nomorUnit",
        "tanggalUjiTerakhir", "jangkaWaktuBulan", "statusKelayakan", temuan, "tindakLanjut", foto,
        "pdfNama", "pdfData", "dibuatOleh"
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [namaPerusahaan, jenisSpip, namaUnit, jenisAlat, nomorUnit,
        tanggalUjiTerakhir, jangkaWaktuBulan, statusKelayakan, temuan, tindakLanjut, foto,
        pdfNama, pdfData, dibuatOleh]
    )
    res.json(rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Gagal menambah data: " + err.message })
  }
})

app.put('/api/unit/:id', verifikasiToken, async (req, res) => {
  const id = Number(req.params.id)
  const { statusKelayakan, tindakLanjut } = req.body

  try {
    const { rows } = await pool.query(
      'UPDATE unit SET "statusKelayakan" = $1, "tindakLanjut" = $2 WHERE id = $3 RETURNING *',
      [statusKelayakan, tindakLanjut, id]
    )
    res.json(rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Gagal update: " + err.message })
  }
})

app.delete('/api/unit/:id', verifikasiToken, async (req, res) => {
  const id = Number(req.params.id)
  try {
    await pool.query('DELETE FROM unit WHERE id = $1', [id])
    res.json({ message: "Berhasil dihapus" })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Gagal menghapus: " + err.message })
  }
})

app.listen(PORT, () => {
  console.log(`Server berjalan di port ${PORT}`)
})