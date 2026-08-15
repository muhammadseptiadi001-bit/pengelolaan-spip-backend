require('dotenv').config()
console.log("CEK DATABASE_URL:", process.env.DATABASE_URL)
const express = require('express')
const cors = require('cors')
const { Pool } = require('pg')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const nodemailer = require('nodemailer')
const cron = require('node-cron')
const multer = require('multer')
const streamifier = require('streamifier')
const cloudinary = require('cloudinary').v2
const { buatAdminRouter } = require('./admin') // Panel admin AdminJS

const app = express()
const PORT = process.env.PORT || 3000
const SECRET_KEY = "spip-rahasia-ganti-nanti-produksi"

app.use(cors())
app.use(express.json({ limit: '20mb' }))

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

// ===== CLOUDINARY SETUP =====

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // maksimal 15MB per file
})

function uploadBufferKeCloudinary(buffer, opsi) {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(opsi, (error, result) => {
      if (error) return reject(error)
      resolve(result)
    })
    streamifier.createReadStream(buffer).pipe(uploadStream)
  })
}

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
      "namaPetugas" TEXT,
      "statusKompetensi" TEXT,
      temuan TEXT,
      "tindakLanjut" TEXT,
      foto TEXT,
      "pdfNama" TEXT,
      "pdfData" TEXT,
      "dibuatOleh" TEXT
    )
  `)

  await pool.query(`ALTER TABLE unit ADD COLUMN IF NOT EXISTS "namaPetugas" TEXT`)
  await pool.query(`ALTER TABLE unit ADD COLUMN IF NOT EXISTS "statusKompetensi" TEXT`)

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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pengaturan_perusahaan (
      id INTEGER PRIMARY KEY DEFAULT 1,
      "prosedurPengujianKelayakan" BOOLEAN DEFAULT false,
      "prosedurPemantauanEvaluasi" BOOLEAN DEFAULT false,
      "diubahOleh" TEXT,
      "diubahPada" TIMESTAMP DEFAULT NOW(),
      CONSTRAINT satu_baris_saja CHECK (id = 1)
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pemeliharaan (
      id SERIAL PRIMARY KEY,
      "unitId" INTEGER,
      "namaUnit" TEXT,
      "nomorUnit" TEXT,
      "jenisPemeliharaan" TEXT,
      "tanggalPelaksanaan" TEXT,
      deskripsi TEXT,
      petugas TEXT,
      "jadwalBerikutnya" TEXT,
      "dibuatOleh" TEXT,
      "dibuatPada" TIMESTAMP DEFAULT NOW()
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pengaturan_pengamanan_instalasi (
      id INTEGER PRIMARY KEY DEFAULT 1,
      "identifikasiKebutuhanPengaman" BOOLEAN DEFAULT false,
      "prosedurPengamananInstalasi" BOOLEAN DEFAULT false,
      "desainPengamananInstalasi" BOOLEAN DEFAULT false,
      "prosedurPemasanganInstalasi" BOOLEAN DEFAULT false,
      "prosedurPemeliharaanPengamanan" BOOLEAN DEFAULT false,
      "programJadwalPemeriksaan" BOOLEAN DEFAULT false,
      "diubahOleh" TEXT,
      "diubahPada" TIMESTAMP DEFAULT NOW(),
      CONSTRAINT satu_baris_saja_pengamanan CHECK (id = 1)
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pemeriksaan_instalasi (
      id SERIAL PRIMARY KEY,
      "unitId" INTEGER,
      "namaUnit" TEXT,
      "nomorUnit" TEXT,
      "tanggalPemeriksaan" TEXT,
      hasil TEXT,
      temuan TEXT,
      petugas TEXT,
      "statusKompetensi" TEXT,
      "jadwalBerikutnya" TEXT,
      "dibuatOleh" TEXT,
      "dibuatPada" TIMESTAMP DEFAULT NOW()
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tenaga_teknik (
      id SERIAL PRIMARY KEY,
      nama TEXT,
      "namaPerusahaan" TEXT,
      "idKaryawan" TEXT,
      jabatan TEXT,
      departemen TEXT,
      kompetensi TEXT,
      "noSertifikat" TEXT,
      "instansiPenerbit" TEXT,
      "tanggalTerbitSertifikat" TEXT,
      "masaBerlakuSertifikat" TEXT,
      "cakupanKompetensi" TEXT,
      "berkasSertifikat" TEXT,
      "dibuatOleh" TEXT,
      "dibuatPada" TIMESTAMP DEFAULT NOW()
    )
  `)

  await pool.query(`ALTER TABLE tenaga_teknik ADD COLUMN IF NOT EXISTS "namaPerusahaan" TEXT`)

  // ===== AUDIT LOG (poin 6) — jejak siapa-kapan-apa yang diubah lewat panel admin =====
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      tabel TEXT,
      "recordId" TEXT,
      aksi TEXT,
      "dataSebelum" JSONB,
      "dataSesudah" JSONB,
      "dilakukanOleh" TEXT,
      "dilakukanPada" TIMESTAMP DEFAULT NOW()
    )
  `)

  // ===== Aspek 5: Evaluasi Laporan Hasil Kajian Teknis (4.4.5) =====
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pengaturan_evaluasi_kajian (
      id INTEGER PRIMARY KEY DEFAULT 1,
      "prosedurEvaluasiKajianTeknis" BOOLEAN DEFAULT false,
      "diubahOleh" TEXT,
      "diubahPada" TIMESTAMP DEFAULT NOW(),
      CONSTRAINT satu_baris_saja_kajian CHECK (id = 1)
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS kajian_teknis (
      id SERIAL PRIMARY KEY,
      "judulKajian" TEXT,
      "jenisKajian" TEXT,
      "keteranganPerubahan" TEXT,
      penyusun TEXT,
      "tanggalKajian" TEXT,
      "fileLaporan" TEXT,
      "statusKememadaian" TEXT,
      "disampaikanKeKait" BOOLEAN DEFAULT false,
      "tanggalPenyampaian" TEXT,
      "namaPenerima" TEXT,
      "catatanEvaluasi" TEXT,
      "dibuatOleh" TEXT,
      "dibuatPada" TIMESTAMP DEFAULT NOW()
    )
  `)

  console.log("Database siap.")
}
setupDatabase()

// ===== ADMIN PANEL (AdminJS) =====
// Dipasang terpisah dari setupDatabase() karena butuh koneksi & inisialisasi sendiri
// (membaca struktur tabel yang sudah dibuat). Kalau gagal terpasang (misal env var
// belum diisi), server utama tetap jalan normal — cuma /admin yang tidak aktif.
async function pasangAdminPanel() {
  try {
    const { admin, router } = await buatAdminRouter()
    app.use(admin.options.rootPath, router)
    console.log(`Admin panel siap di ${admin.options.rootPath}`)
  } catch (err) {
    console.error("Gagal memasang admin panel:", err.message)
  }
}
pasangAdminPanel()

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

// ===== PENGATURAN TINGKAT PERUSAHAAN =====

app.get('/api/pengaturan-perusahaan', verifikasiToken, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM pengaturan_perusahaan WHERE id = 1')
    if (rows.length === 0) {
      const { rows: rowsBaru } = await pool.query(
        `INSERT INTO pengaturan_perusahaan (id, "prosedurPengujianKelayakan", "prosedurPemantauanEvaluasi")
         VALUES (1, false, false) RETURNING *`
      )
      return res.json(rowsBaru[0])
    }
    res.json(rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Gagal mengambil pengaturan perusahaan: " + err.message })
  }
})

app.put('/api/pengaturan-perusahaan', verifikasiToken, async (req, res) => {
  const { prosedurPengujianKelayakan, prosedurPemantauanEvaluasi } = req.body

  try {
    const { rows } = await pool.query(
      `INSERT INTO pengaturan_perusahaan (id, "prosedurPengujianKelayakan", "prosedurPemantauanEvaluasi", "diubahOleh", "diubahPada")
       VALUES (1, $1, $2, $3, NOW())
       ON CONFLICT (id) DO UPDATE SET
         "prosedurPengujianKelayakan" = $1,
         "prosedurPemantauanEvaluasi" = $2,
         "diubahOleh" = $3,
         "diubahPada" = NOW()
       RETURNING *`,
      [!!prosedurPengujianKelayakan, !!prosedurPemantauanEvaluasi, req.user.nama]
    )
    res.json(rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Gagal menyimpan pengaturan perusahaan: " + err.message })
  }
})

// ===== PENGATURAN PENGAMANAN INSTALASI (Aspek 2 — 4.4.2, poin 2-7) =====

app.get('/api/pengaturan-pengamanan-instalasi', verifikasiToken, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM pengaturan_pengamanan_instalasi WHERE id = 1')
    if (rows.length === 0) {
      const { rows: rowsBaru } = await pool.query(
        `INSERT INTO pengaturan_pengamanan_instalasi (
          id, "identifikasiKebutuhanPengaman", "prosedurPengamananInstalasi", "desainPengamananInstalasi",
          "prosedurPemasanganInstalasi", "prosedurPemeliharaanPengamanan", "programJadwalPemeriksaan"
        ) VALUES (1, false, false, false, false, false, false) RETURNING *`
      )
      return res.json(rowsBaru[0])
    }
    res.json(rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Gagal mengambil pengaturan pengamanan instalasi: " + err.message })
  }
})

app.put('/api/pengaturan-pengamanan-instalasi', verifikasiToken, async (req, res) => {
  const {
    identifikasiKebutuhanPengaman, prosedurPengamananInstalasi, desainPengamananInstalasi,
    prosedurPemasanganInstalasi, prosedurPemeliharaanPengamanan, programJadwalPemeriksaan
  } = req.body

  try {
    const { rows } = await pool.query(
      `INSERT INTO pengaturan_pengamanan_instalasi (
        id, "identifikasiKebutuhanPengaman", "prosedurPengamananInstalasi", "desainPengamananInstalasi",
        "prosedurPemasanganInstalasi", "prosedurPemeliharaanPengamanan", "programJadwalPemeriksaan",
        "diubahOleh", "diubahPada"
      ) VALUES (1, $1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (id) DO UPDATE SET
        "identifikasiKebutuhanPengaman" = $1,
        "prosedurPengamananInstalasi" = $2,
        "desainPengamananInstalasi" = $3,
        "prosedurPemasanganInstalasi" = $4,
        "prosedurPemeliharaanPengamanan" = $5,
        "programJadwalPemeriksaan" = $6,
        "diubahOleh" = $7,
        "diubahPada" = NOW()
      RETURNING *`,
      [
        !!identifikasiKebutuhanPengaman, !!prosedurPengamananInstalasi, !!desainPengamananInstalasi,
        !!prosedurPemasanganInstalasi, !!prosedurPemeliharaanPengamanan, !!programJadwalPemeriksaan,
        req.user.nama
      ]
    )
    res.json(rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Gagal menyimpan pengaturan pengamanan instalasi: " + err.message })
  }
})

// ===== PEMERIKSAAN INSTALASI (Aspek 2 — 4.4.2, poin 8) =====

app.get('/api/pemeriksaan-instalasi', verifikasiToken, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM pemeriksaan_instalasi ORDER BY id DESC')
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Gagal mengambil data pemeriksaan instalasi: " + err.message })
  }
})

app.post('/api/pemeriksaan-instalasi', verifikasiToken, async (req, res) => {
  const {
    unitId, namaUnit, nomorUnit, tanggalPemeriksaan,
    hasil, temuan, petugas, statusKompetensi, jadwalBerikutnya
  } = req.body

  if (!unitId || !namaUnit || !nomorUnit || !tanggalPemeriksaan || !hasil) {
    return res.status(400).json({ error: "Unit, Tanggal Pemeriksaan, dan Hasil Pemeriksaan wajib diisi." })
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO pemeriksaan_instalasi (
        "unitId", "namaUnit", "nomorUnit", "tanggalPemeriksaan",
        hasil, temuan, petugas, "statusKompetensi", "jadwalBerikutnya", "dibuatOleh"
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [unitId, namaUnit, nomorUnit, tanggalPemeriksaan, hasil, temuan || "", petugas || "", statusKompetensi || "", jadwalBerikutnya || null, req.user.nama]
    )
    res.json(rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Gagal menyimpan pemeriksaan instalasi: " + err.message })
  }
})

app.delete('/api/pemeriksaan-instalasi/:id', verifikasiToken, async (req, res) => {
  const id = Number(req.params.id)
  try {
    await pool.query('DELETE FROM pemeriksaan_instalasi WHERE id = $1', [id])
    res.json({ message: "Berhasil dihapus" })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Gagal menghapus pemeriksaan instalasi: " + err.message })
  }
})

// ===== PEMELIHARAAN (Aspek 1 — Sistem & Pelaksanaan Pemeliharaan SPIP) =====

app.get('/api/pemeliharaan', verifikasiToken, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM pemeliharaan ORDER BY id DESC')
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Gagal mengambil data pemeliharaan: " + err.message })
  }
})

app.post('/api/pemeliharaan', verifikasiToken, async (req, res) => {
  const {
    unitId, namaUnit, nomorUnit, jenisPemeliharaan,
    tanggalPelaksanaan, deskripsi, petugas, jadwalBerikutnya
  } = req.body

  if (!unitId || !namaUnit || !nomorUnit || !jenisPemeliharaan || !tanggalPelaksanaan) {
    return res.status(400).json({ error: "Unit, Jenis Pemeliharaan, dan Tanggal Pelaksanaan wajib diisi." })
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO pemeliharaan (
        "unitId", "namaUnit", "nomorUnit", "jenisPemeliharaan",
        "tanggalPelaksanaan", deskripsi, petugas, "jadwalBerikutnya", "dibuatOleh"
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [unitId, namaUnit, nomorUnit, jenisPemeliharaan, tanggalPelaksanaan, deskripsi || "", petugas || "", jadwalBerikutnya || null, req.user.nama]
    )
    res.json(rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Gagal menyimpan pemeliharaan: " + err.message })
  }
})

app.delete('/api/pemeliharaan/:id', verifikasiToken, async (req, res) => {
  const id = Number(req.params.id)
  try {
    await pool.query('DELETE FROM pemeliharaan WHERE id = $1', [id])
    res.json({ message: "Berhasil dihapus" })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Gagal menghapus pemeliharaan: " + err.message })
  }
})

// ===== TENAGA TEKNIK (Aspek 4 — Kompetensi Tenaga Teknik, 4.4.4) =====

app.get('/api/tenaga-teknik', verifikasiToken, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM tenaga_teknik ORDER BY id DESC')
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Gagal mengambil data tenaga teknik: " + err.message })
  }
})

app.post('/api/tenaga-teknik', verifikasiToken, async (req, res) => {
  const {
    nama, namaPerusahaan, idKaryawan, jabatan, departemen, kompetensi, noSertifikat,
    instansiPenerbit, tanggalTerbitSertifikat, masaBerlakuSertifikat, berkasSertifikat
  } = req.body

  if (!nama || !idKaryawan || !jabatan || !kompetensi || !noSertifikat) {
    return res.status(400).json({ error: "Nama, ID Karyawan, Jabatan, Kompetensi, dan No Sertifikat wajib diisi." })
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO tenaga_teknik (
        nama, "namaPerusahaan", "idKaryawan", jabatan, departemen, kompetensi, "noSertifikat",
        "instansiPenerbit", "tanggalTerbitSertifikat", "masaBerlakuSertifikat", "berkasSertifikat", "dibuatOleh"
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        nama, namaPerusahaan || "", idKaryawan, jabatan, departemen || "", kompetensi, noSertifikat,
        instansiPenerbit || "", tanggalTerbitSertifikat || null, masaBerlakuSertifikat || null,
        berkasSertifikat || null, req.user.nama
      ]
    )
    res.json(rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Gagal menyimpan tenaga teknik: " + err.message })
  }
})

app.delete('/api/tenaga-teknik/:id', verifikasiToken, async (req, res) => {
  const id = Number(req.params.id)
  try {
    await pool.query('DELETE FROM tenaga_teknik WHERE id = $1', [id])
    res.json({ message: "Berhasil dihapus" })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Gagal menghapus tenaga teknik: " + err.message })
  }
})

// ===== EVALUASI LAPORAN HASIL KAJIAN TEKNIS (Aspek 5, 4.4.5) =====

app.get('/api/pengaturan-evaluasi-kajian', verifikasiToken, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM pengaturan_evaluasi_kajian WHERE id = 1')
    if (rows.length === 0) {
      const { rows: rowsBaru } = await pool.query(
        `INSERT INTO pengaturan_evaluasi_kajian (id, "prosedurEvaluasiKajianTeknis")
         VALUES (1, false) RETURNING *`
      )
      return res.json(rowsBaru[0])
    }
    res.json(rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Gagal mengambil pengaturan evaluasi kajian: " + err.message })
  }
})

app.put('/api/pengaturan-evaluasi-kajian', verifikasiToken, async (req, res) => {
  const { prosedurEvaluasiKajianTeknis } = req.body

  try {
    const { rows } = await pool.query(
      `INSERT INTO pengaturan_evaluasi_kajian (id, "prosedurEvaluasiKajianTeknis", "diubahOleh", "diubahPada")
       VALUES (1, $1, $2, NOW())
       ON CONFLICT (id) DO UPDATE SET
         "prosedurEvaluasiKajianTeknis" = $1,
         "diubahOleh" = $2,
         "diubahPada" = NOW()
       RETURNING *`,
      [!!prosedurEvaluasiKajianTeknis, req.user.nama]
    )
    res.json(rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Gagal menyimpan pengaturan evaluasi kajian: " + err.message })
  }
})

app.get('/api/kajian-teknis', verifikasiToken, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM kajian_teknis ORDER BY id DESC')
    res.json(rows)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Gagal mengambil data kajian teknis: " + err.message })
  }
})

app.post('/api/kajian-teknis', verifikasiToken, async (req, res) => {
  const {
    judulKajian, jenisKajian, keteranganPerubahan, penyusun, tanggalKajian,
    fileLaporan, statusKememadaian, disampaikanKeKait, tanggalPenyampaian,
    namaPenerima, catatanEvaluasi
  } = req.body

  if (!judulKajian || !jenisKajian || !tanggalKajian) {
    return res.status(400).json({ error: "Judul Kajian, Jenis Kajian, dan Tanggal Kajian wajib diisi." })
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO kajian_teknis (
        "judulKajian", "jenisKajian", "keteranganPerubahan", penyusun, "tanggalKajian",
        "fileLaporan", "statusKememadaian", "disampaikanKeKait", "tanggalPenyampaian",
        "namaPenerima", "catatanEvaluasi", "dibuatOleh"
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        judulKajian, jenisKajian, keteranganPerubahan || "", penyusun || "", tanggalKajian,
        fileLaporan || null, statusKememadaian || "Belum Direview", !!disampaikanKeKait,
        tanggalPenyampaian || null, namaPenerima || "", catatanEvaluasi || "", req.user.nama
      ]
    )
    res.json(rows[0])
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Gagal menyimpan kajian teknis: " + err.message })
  }
})

app.delete('/api/kajian-teknis/:id', verifikasiToken, async (req, res) => {
  const id = Number(req.params.id)
  try {
    await pool.query('DELETE FROM kajian_teknis WHERE id = $1', [id])
    res.json({ message: "Berhasil dihapus" })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Gagal menghapus kajian teknis: " + err.message })
  }
})

// ===== UPLOAD FILE KE CLOUDINARY =====

app.post('/api/upload', verifikasiToken, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Tidak ada file yang dikirim." })
  }

  const tipe = req.body.tipe === 'pdf' ? 'pdf' : 'foto'

  try {
    const opsi = {
      folder: 'spip',
      resource_type: tipe === 'pdf' ? 'raw' : 'image',
    }

    const hasil = await uploadBufferKeCloudinary(req.file.buffer, opsi)

    res.json({
      url: hasil.secure_url,
      namaAsli: req.file.originalname,
    })
  } catch (err) {
    console.error("Gagal upload ke Cloudinary:", err)
    res.status(500).json({ error: "Gagal mengupload file: " + err.message })
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
    const {
      perusahaan = "",
      jenisSpip = "Semua",
      namaUnit = "",
      jenisAlat = "Semua",
      nomorUnit = "",
      statusKelayakan = "Semua",
      statusWaktu = "Semua",
      semua = "false",
    } = req.query

    const kondisi = []
    const nilai = []
    let idx = 1

    if (perusahaan) {
      kondisi.push(`"namaPerusahaan" ILIKE $${idx++}`)
      nilai.push(`%${perusahaan}%`)
    }
    if (jenisSpip !== "Semua") {
      kondisi.push(`"jenisSpip" = $${idx++}`)
      nilai.push(jenisSpip)
    }
    if (namaUnit) {
      kondisi.push(`"namaUnit" ILIKE $${idx++}`)
      nilai.push(`%${namaUnit}%`)
    }
    if (jenisAlat !== "Semua") {
      kondisi.push(`"jenisAlat" = $${idx++}`)
      nilai.push(jenisAlat)
    }
    if (nomorUnit) {
      kondisi.push(`"nomorUnit" ILIKE $${idx++}`)
      nilai.push(`%${nomorUnit}%`)
    }
    if (statusKelayakan !== "Semua") {
      kondisi.push(`"statusKelayakan" = $${idx++}`)
      nilai.push(statusKelayakan)
    }
    if (statusWaktu === "Sudah Lewat") {
      kondisi.push(`jatuh_tempo < NOW()`)
    } else if (statusWaktu === "Mendekati Jatuh Tempo") {
      kondisi.push(`jatuh_tempo >= NOW() AND jatuh_tempo <= NOW() + INTERVAL '30 days'`)
    } else if (statusWaktu === "Aman") {
      kondisi.push(`jatuh_tempo > NOW() + INTERVAL '30 days'`)
    }

    const whereClause = kondisi.length > 0 ? `WHERE ${kondisi.join(' AND ')}` : ""

    const queryDasar = `
      FROM (
        SELECT *,
          "tanggalUjiTerakhir"::timestamp + ("jangkaWaktuBulan" * INTERVAL '1 month') AS jatuh_tempo
        FROM unit
      ) unit_dengan_tempo
      ${whereClause}
    `

    if (semua === "true") {
      const queryData = `SELECT * ${queryDasar} ORDER BY id DESC`
      const { rows } = await pool.query(queryData, nilai)
      return res.json({ data: rows, totalData: rows.length })
    }

    const halaman = Math.max(1, Number(req.query.halaman) || 1)
    const batas = Math.max(1, Number(req.query.batas) || 10)
    const offset = (halaman - 1) * batas

    const queryData = `SELECT * ${queryDasar} ORDER BY id DESC LIMIT $${idx++} OFFSET $${idx++}`
    const queryHitung = `SELECT COUNT(*)::int AS total ${queryDasar}`
    const nilaiData = [...nilai, batas, offset]

    const [hasilData, hasilHitung] = await Promise.all([
      pool.query(queryData, nilaiData),
      pool.query(queryHitung, nilai),
    ])

    const totalData = hasilHitung.rows[0].total
    const totalHalaman = Math.max(1, Math.ceil(totalData / batas))

    res.json({ data: hasilData.rows, totalData, totalHalaman, halaman })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Gagal mengambil data: " + err.message })
  }
})

app.post('/api/unit', verifikasiToken, async (req, res) => {
  const {
    namaPerusahaan, jenisSpip, namaUnit, jenisAlat, nomorUnit,
    tanggalUjiTerakhir, jangkaWaktuBulan, statusKelayakan, namaPetugas, statusKompetensi,
    temuan, tindakLanjut, foto, pdfNama, pdfData, dibuatOleh
  } = req.body

  try {
    const { rows } = await pool.query(
      `INSERT INTO unit (
        "namaPerusahaan", "jenisSpip", "namaUnit", "jenisAlat", "nomorUnit",
        "tanggalUjiTerakhir", "jangkaWaktuBulan", "statusKelayakan", "namaPetugas", "statusKompetensi",
        temuan, "tindakLanjut", foto, "pdfNama", "pdfData", "dibuatOleh"
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [namaPerusahaan, jenisSpip, namaUnit, jenisAlat, nomorUnit,
        tanggalUjiTerakhir, jangkaWaktuBulan, statusKelayakan, namaPetugas, statusKompetensi,
        temuan, tindakLanjut, foto, pdfNama, pdfData, dibuatOleh]
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
  const { statusKelayakan, tindakLanjut, namaPetugas, statusKompetensi } = req.body

  try {
    const { rows: rowsLama } = await pool.query('SELECT * FROM unit WHERE id = $1', [id])
    const unitLama = rowsLama[0]

    const { rows } = await pool.query(
      'UPDATE unit SET "statusKelayakan" = $1, "tindakLanjut" = $2, "namaPetugas" = $3, "statusKompetensi" = $4 WHERE id = $5 RETURNING *',
      [statusKelayakan, tindakLanjut, namaPetugas, statusKompetensi, id]
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