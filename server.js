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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS riwayat_status (
      id SERIAL PRIMARY KEY,
      "unitId" INTEGER,
      "namaUnit" TEXT,
      "nomorUnit" TEXT,
      "statusLama" TEXT,
      "statusBaru" TEXT,
      "diubahOleh" TEXT,
      "diubahPada" TIMESTAMP DEFAULT NOW()
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

function formatTanggalId(tanggal) {
  return new Date(tanggal).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })
}

function hitungJatuhTempoServer(tanggalUjiTerakhir, jangkaWaktuBulan) {
  const jatuhTempo = new Date(tanggalUjiTerakhir)
  jatuhTempo.setMonth(jatuhTempo.getMonth() + Number(jangkaWaktuBulan))
  return jatuhTempo
}

function hitungSisaHari(jatuhTempo) {
  const sekarang = new Date()
  const tglSekarang = new Date(sekarang.getFullYear(), sekarang.getMonth(), sekarang.getDate())
  const tglJatuhTempo = new Date(jatuhTempo.getFullYear(), jatuhTempo.getMonth(), jatuhTempo.getDate())
  return Math.round((tglJatuhTempo - tglSekarang) / (1000 * 60 * 60 * 24))
}

function templateLaporanUnit(unit, jatuhTempo, sisaHari, labelTrigger) {
  const badgeWarna = unit.statusKelayakan === "Layak" ? "#dcfce7;color:#15803d"
    : unit.statusKelayakan === "Tidak Layak" ? "#fee2e2;color:#b91c1c"
    : "#fef9c3;color:#a16207"

  return `
    <div style="font-family: Arial, Helvetica, sans-serif; color:#1f2937; max-width:600px; margin:0 auto;">
      <div style="text-align:center; border-bottom:3px solid #1f2937; padding-bottom:12px; margin-bottom:20px;">
        <h2 style="font-size:16px; margin:0;">⚠️ ${labelTrigger}</h2>
        <p style="font-size:12px; color:#6b7280; margin-top:4px;">Sistem Pengamanan Instalasi Pertambangan (SPIP)</p>
      </div>

      <table style="width:100%; border-collapse:collapse; margin-bottom:16px;">
        <tr><td style="border:1px solid #d1d5db; padding:8px 10px; font-weight:bold; background:#f9fafb; width:180px;">Nama Perusahaan</td><td style="border:1px solid #d1d5db; padding:8px 10px;">${unit.namaPerusahaan}</td></tr>
        <tr><td style="border:1px solid #d1d5db; padding:8px 10px; font-weight:bold; background:#f9fafb;">Kategori SPIP</td><td style="border:1px solid #d1d5db; padding:8px 10px;">${unit.jenisSpip}</td></tr>
        <tr><td style="border:1px solid #d1d5db; padding:8px 10px; font-weight:bold; background:#f9fafb;">Jenis Alat</td><td style="border:1px solid #d1d5db; padding:8px 10px;">${unit.jenisAlat}</td></tr>
        <tr><td style="border:1px solid #d1d5db; padding:8px 10px; font-weight:bold; background:#f9fafb;">Nama/Model Unit</td><td style="border:1px solid #d1d5db; padding:8px 10px;">${unit.namaUnit}</td></tr>
        <tr><td style="border:1px solid #d1d5db; padding:8px 10px; font-weight:bold; background:#f9fafb;">Nomor Unit</td><td style="border:1px solid #d1d5db; padding:8px 10px;">${unit.nomorUnit}</td></tr>
        <tr><td style="border:1px solid #d1d5db; padding:8px 10px; font-weight:bold; background:#f9fafb;">Tanggal Uji Terakhir</td><td style="border:1px solid #d1d5db; padding:8px 10px;">${formatTanggalId(unit.tanggalUjiTerakhir)}</td></tr>
        <tr><td style="border:1px solid #d1d5db; padding:8px 10px; font-weight:bold; background:#f9fafb;">Jatuh Tempo</td><td style="border:1px solid #d1d5db; padding:8px 10px;">${formatTanggalId(jatuhTempo)}</td></tr>
        <tr><td style="border:1px solid #d1d5db; padding:8px 10px; font-weight:bold; background:#f9fafb;">Sisa Waktu</td><td style="border:1px solid #d1d5db; padding:8px 10px;">${sisaHari <= 0 ? "Hari ini jatuh tempo" : `${sisaHari} hari lagi`}</td></tr>
        <tr><td style="border:1px solid #d1d5db; padding:8px 10px; font-weight:bold; background:#f9fafb;">Status Kelayakan</td><td style="border:1px solid #d1d5db; padding:8px 10px;"><span style="background:${badgeWarna.split(";")[0]}; color:${badgeWarna.split(";")[1].replace("color:", "")}; padding:3px 10px; border-radius:999px; font-size:12px; font-weight:bold;">${unit.statusKelayakan}</span></td></tr>
        <tr><td style="border:1px solid #d1d5db; padding:8px 10px; font-weight:bold; background:#f9fafb;">Temuan</td><td style="border:1px solid #d1d5db; padding:8px 10px;">${unit.temuan || "-"}</td></tr>
        <tr><td style="border:1px solid #d1d5db; padding:8px 10px; font-weight:bold; background:#f9fafb;">Tindak Lanjut</td><td style="border:1px solid #d1d5db; padding:8px 10px;">${unit.tindakLanjut || "-"}</td></tr>
      </table>

      <p style="font-size:12px; color:#6b7280;">Silakan buka aplikasi Pengelolaan SPIP untuk detail lebih lanjut dan tindak lanjut yang diperlukan.</p>
    </div>
  `
}

async function jalankanPengecekanJatuhTempo() {
  const { rows: semuaUnit } = await pool.query('SELECT * FROM unit')
  const { rows: semuaUser } = await pool.query("SELECT * FROM users WHERE email IS NOT NULL AND email != ''")

  if (semuaUser.length === 0) {
    return { terkirim: 0, pesan: "Belum ada user dengan email terdaftar." }
  }

  let totalTerkirim = 0

  for (const unit of semuaUnit) {
    const jatuhTempo = hitungJatuhTempoServer(unit.tanggalUjiTerakhir, unit.jangkaWaktuBulan)
    const sisaHari = hitungSisaHari(jatuhTempo)

    let labelTrigger = null
    if (sisaHari === 30) labelTrigger = "Peringatan: Sisa Waktu 1 Bulan Menuju Jatuh Tempo Uji Kelayakan"
    else if (sisaHari === 7) labelTrigger = "Peringatan: 7 Hari Menuju Jatuh Tempo Uji Kelayakan"
    else if (sisaHari === 0) labelTrigger = "Peringatan: Hari Ini Jatuh Tempo Uji Kelayakan"

    if (!labelTrigger) continue

    const htmlEmail = templateLaporanUnit(unit, jatuhTempo, sisaHari, labelTrigger)

    for (const user of semuaUser) {
      try {
        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: user.email,
          subject: `⚠️ ${labelTrigger} - ${unit.namaUnit} (${unit.nomorUnit})`,
          html: htmlEmail,
        })
        totalTerkirim++
      } catch (err) {
        console.error(`Gagal kirim email ke ${user.email}:`, err.message)
      }
    }
  }

  return { terkirim: totalTerkirim, pesan: `Pengecekan selesai. ${totalTerkirim} email terkirim.` }
}

cron.schedule('0 8 * * *', () => {
  console.log("Menjalankan pengecekan notifikasi terjadwal...")
  jalankanPengecekanJatuhTempo()
}, {
  timezone: "Asia/Jakarta"
})

app.post('/api/kirim-notifikasi', verifikasiToken, async (req, res) => {
  try {
    const hasil = await jalankanPengecekanJatuhTempo()
    res.json(hasil)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Gagal mengirim notifikasi: " + err.message })
  }
})

// ===== BACKUP DATABASE =====

async function jalankanBackup() {
  const { rows: semuaUnit } = await pool.query('SELECT * FROM unit')
  const { rows: semuaUserMentah } = await pool.query('SELECT id, nama, username, email FROM users')

  const isiBackup = {
    dibuatPada: new Date().toISOString(),
    jumlahUnit: semuaUnit.length,
    jumlahUser: semuaUserMentah.length,
    unit: semuaUnit,
    users: semuaUserMentah,
  }

  const namaFile = `backup-spip-${new Date().toISOString().slice(0, 10)}.json`
  const isiFileJson = JSON.stringify(isiBackup, null, 2)

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: process.env.EMAIL_USER,
    subject: `📦 Backup Database SPIP - ${new Date().toLocaleDateString("id-ID")}`,
    html: `
      <h2>Backup Otomatis Database Pengelolaan SPIP</h2>
      <p>Backup ini dibuat pada ${new Date().toLocaleString("id-ID")}.</p>
      <ul>
        <li>Jumlah unit: ${semuaUnit.length}</li>
        <li>Jumlah user: ${semuaUserMentah.length}</li>
      </ul>
      <p>File backup terlampir dalam format JSON.</p>
    `,
    attachments: [
      {
        filename: namaFile,
        content: isiFileJson,
        contentType: 'application/json',
      },
    ],
  })

  return { pesan: `Backup berhasil dikirim (${semuaUnit.length} unit, ${semuaUserMentah.length} user).`, namaFile }
}

cron.schedule('0 2 * * 0', () => {
  console.log("Menjalankan backup database terjadwal...")
  jalankanBackup().catch((err) => console.error("Gagal backup terjadwal:", err.message))
}, {
  timezone: "Asia/Jakarta"
})

app.post('/api/backup-manual', verifikasiToken, async (req, res) => {
  try {
    const hasil = await jalankanBackup()
    res.json(hasil)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Gagal membuat backup: " + err.message })
  }
})

// ===== RIWAYAT PERUBAHAN STATUS =====

app.get('/api/riwayat', verifikasiToken, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM riwayat_status ORDER BY "diubahPada" DESC')
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Gagal mengambil riwayat: " + err.message })
  }
})

app.get('/api/riwayat/unit/:id', verifikasiToken, async (req, res) => {
  const id = Number(req.params.id)
  try {
    const { rows } = await pool.query('SELECT * FROM riwayat_status WHERE "unitId" = $1 ORDER BY "diubahPada" DESC', [id])
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Gagal mengambil riwayat unit: " + err.message })
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

// ===== IMPORT DATA DARI EXCEL =====

app.post('/api/unit/import', verifikasiToken, async (req, res) => {
  const { daftarUnit } = req.body

  if (!Array.isArray(daftarUnit) || daftarUnit.length === 0) {
    return res.status(400).json({ error: "Tidak ada data untuk diimpor." })
  }

  let ditambahkan = 0
  let diupdate = 0
  const gagal = []

  for (const unit of daftarUnit) {
    const {
      namaPerusahaan, jenisSpip, namaUnit, jenisAlat, nomorUnit,
      tanggalUjiTerakhir, jangkaWaktuBulan, statusKelayakan, temuan, tindakLanjut
    } = unit

    if (!namaPerusahaan || !jenisSpip || !namaUnit || !jenisAlat || !nomorUnit || !tanggalUjiTerakhir || !jangkaWaktuBulan || !statusKelayakan) {
      gagal.push({ nomorUnit: nomorUnit || "(kosong)", alasan: "Ada kolom wajib yang kosong atau format tidak dikenali" })
      continue
    }

    try {
      const { rows: adaData } = await pool.query('SELECT id FROM unit WHERE "nomorUnit" = $1', [nomorUnit])

      if (adaData.length > 0) {
        await pool.query(
          `UPDATE unit SET
            "namaPerusahaan" = $1, "jenisSpip" = $2, "namaUnit" = $3, "jenisAlat" = $4,
            "tanggalUjiTerakhir" = $5, "jangkaWaktuBulan" = $6, "statusKelayakan" = $7,
            temuan = $8, "tindakLanjut" = $9
           WHERE "nomorUnit" = $10`,
          [namaPerusahaan, jenisSpip, namaUnit, jenisAlat, tanggalUjiTerakhir, jangkaWaktuBulan, statusKelayakan, temuan || "", tindakLanjut || "", nomorUnit]
        )
        diupdate++
      } else {
        await pool.query(
          `INSERT INTO unit (
            "namaPerusahaan", "jenisSpip", "namaUnit", "jenisAlat", "nomorUnit",
            "tanggalUjiTerakhir", "jangkaWaktuBulan", "statusKelayakan", temuan, "tindakLanjut", "dibuatOleh"
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [namaPerusahaan, jenisSpip, namaUnit, jenisAlat, nomorUnit, tanggalUjiTerakhir, jangkaWaktuBulan, statusKelayakan, temuan || "", tindakLanjut || "", req.user.nama]
        )
        ditambahkan++
      }
    } catch (err) {
      gagal.push({ nomorUnit, alasan: err.message })
    }
  }

  res.json({
    pesan: `Impor selesai: ${ditambahkan} unit baru ditambahkan, ${diupdate} unit diupdate, ${gagal.length} gagal.`,
    ditambahkan,
    diupdate,
    gagal,
  })
})

app.put('/api/unit/:id', verifikasiToken, async (req, res) => {
  const id = Number(req.params.id)
  const { statusKelayakan, tindakLanjut } = req.body

  try {
    const { rows: rowsLama } = await pool.query('SELECT * FROM unit WHERE id = $1', [id])
    const unitLama = rowsLama[0]

    const { rows } = await pool.query(
      'UPDATE unit SET "statusKelayakan" = $1, "tindakLanjut" = $2 WHERE id = $3 RETURNING *',
      [statusKelayakan, tindakLanjut, id]
    )

    if (unitLama && unitLama.statusKelayakan !== statusKelayakan) {
      await pool.query(
        `INSERT INTO riwayat_status ("unitId", "namaUnit", "nomorUnit", "statusLama", "statusBaru", "diubahOleh")
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, unitLama.namaUnit, unitLama.nomorUnit, unitLama.statusKelayakan, statusKelayakan, req.user.nama]
      )
    }

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