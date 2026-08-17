// Panel admin AdminJS — di-load pakai dynamic import() karena AdminJS v7 ke atas adalah
// paket ESM murni (tidak bisa dipanggil pakai require() biasa dari project CommonJS ini).
// Kalau pakai require('adminjs') langsung di level atas file, Node akan melempar error
// ERR_REQUIRE_ESM SAAT FILE INI DI-REQUIRE oleh server.js (bukan saat fungsi ini dipanggil) —
// itu sebabnya sebelumnya seluruh server crash total, bahkan sebelum sempat masuk ke
// try/catch di pasangAdminPanel() pada server.js.

const path = require('path')
const { Pool } = require('pg')

// Daftar tabel yang didaftarkan manual satu-satu (bukan pakai "databases: [db]" auto-register
// lagi), supaya tiap tabel bisa dikasih hook audit log sendiri-sendiri. Kalau nanti nambah
// tabel baru di server.js, tambahkan juga nama tabelnya di sini supaya ikut muncul di panel
// admin dan (kalau relevan) ikut tercatat di audit log. Tabel-tabel ini juga otomatis dapat
// tombol Import/Export (lihat resourceDenganAudit di bawah).
const DAFTAR_TABEL_DIAUDIT = [
  'users',
  'unit',
  'riwayat_status',
  'pengaturan_perusahaan',
  'pemeliharaan',
  'pengaturan_pengamanan_instalasi',
  'pemeriksaan_instalasi',
  'tenaga_teknik',
  'pengaturan_evaluasi_kajian',
  'kajian_teknis',
]

async function buatAdminRouter() {
  const { default: AdminJS, ComponentLoader } = await import('adminjs')
  const { default: AdminJSExpress } = await import('@adminjs/express')
  // PENTING: class yang harus di-instansiasi & dipanggil .init() adalah "Adapter"
  // (default export dari @adminjs/sql), BUKAN "Database". "Database" dan "Resource"
  // di sini cuma dipakai untuk AdminJS.registerAdapter — mereka adalah class internal
  // yang dipakai Adapter di belakang layar, bukan untuk dipanggil manual.
  const { default: Adapter, Database, Resource } = await import('@adminjs/sql')
  // Plugin resmi untuk tombol Import/Export per tabel di panel admin.
  const { default: importExportFeature } = await import('@adminjs/import-export')

  AdminJS.registerAdapter({ Database, Resource })

  // ComponentLoader wajib ada supaya AdminJS bisa mem-bundle komponen React custom —
  // dipakai untuk fitur Import/Export dan juga untuk Dashboard ringkasan di bawah.
  const componentLoader = new ComponentLoader()
  const Components = {
    Dashboard: componentLoader.add('Dashboard', path.join(__dirname, 'admin-components', 'Dashboard')),
  }

  const db = await new Adapter('postgresql', {
    connectionString: process.env.DATABASE_URL,
    database: 'railway',
  }).init()

  // Pool koneksi TERPISAH khusus untuk menulis ke tabel audit_log dari dalam hook, dan
  // juga dipakai untuk query ringkasan Dashboard — dibuat sendiri (bukan pinjam dari
  // server.js) supaya admin.js tetap mandiri/tidak perlu server.js mengoper pool sebagai
  // parameter.
  const poolAudit = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  })

  async function catatAudit({ tabel, recordId, aksi, dataSebelum, dataSesudah, pelaku }) {
    try {
      await poolAudit.query(
        `INSERT INTO audit_log (tabel, "recordId", aksi, "dataSebelum", "dataSesudah", "dilakukanOleh")
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          tabel,
          recordId != null ? String(recordId) : null,
          aksi,
          dataSebelum ? JSON.stringify(dataSebelum) : null,
          dataSesudah ? JSON.stringify(dataSesudah) : null,
          pelaku || 'tidak diketahui',
        ]
      )
    } catch (err) {
      // Sengaja cuma di-log ke console, TIDAK melempar error — supaya kalau pencatatan
      // audit gagal (misal koneksi bermasalah sesaat), aksi tambah/ubah/hapus user di
      // panel admin tetap berhasil, tidak ikut gagal gara-gara logging-nya.
      console.error(`Gagal mencatat audit log (tabel: ${tabel}):`, err.message)
    }
  }

  // Menghasilkan konfigurasi hook untuk satu tabel — dipakai berulang untuk semua tabel
  // di DAFTAR_TABEL_DIAUDIT supaya tidak menulis hook yang sama berkali-kali manual.
  function buatHookAudit(namaTabel) {
    return {
      new: {
        after: async (response, request, context) => {
          if (response?.record?.params && (!response.record.errors || Object.keys(response.record.errors).length === 0)) {
            await catatAudit({
              tabel: namaTabel,
              recordId: response.record.params.id,
              aksi: 'tambah',
              dataSebelum: null,
              dataSesudah: response.record.params,
              pelaku: context.currentAdmin?.email,
            })
          }
          return response
        },
      },
      edit: {
        before: async (request, context) => {
          // Simpan data SEBELUM diubah di context, supaya bisa dibandingkan di hook "after".
          if (context.record) {
            context.dataSebelumEdit = { ...context.record.params }
          }
          return request
        },
        after: async (response, request, context) => {
          if (response?.record?.params && (!response.record.errors || Object.keys(response.record.errors).length === 0)) {
            await catatAudit({
              tabel: namaTabel,
              recordId: response.record.params.id,
              aksi: 'ubah',
              dataSebelum: context.dataSebelumEdit || null,
              dataSesudah: response.record.params,
              pelaku: context.currentAdmin?.email,
            })
          }
          return response
        },
      },
      delete: {
        before: async (request, context) => {
          if (context.record) {
            context.dataSebelumHapus = { ...context.record.params }
          }
          return request
        },
        after: async (response, request, context) => {
          await catatAudit({
            tabel: namaTabel,
            recordId: context.dataSebelumHapus?.id ?? request.params?.recordId ?? null,
            aksi: 'hapus',
            dataSebelum: context.dataSebelumHapus || null,
            dataSesudah: null,
            pelaku: context.currentAdmin?.email,
          })
          return response
        },
      },
    }
  }

  // Tabel-tabel biasa: didaftarkan manual + dikasih hook audit + fitur Import/Export.
  const resourceDenganAudit = DAFTAR_TABEL_DIAUDIT.map((namaTabel) => ({
    resource: db.table(namaTabel),
    options: {
      actions: buatHookAudit(namaTabel),
    },
    features: [importExportFeature({ componentLoader })],
  }))

  // Tabel audit_log itu sendiri: didaftarkan juga supaya bisa DILIHAT di panel admin,
  // tapi dibuat READ-ONLY (tidak bisa tambah/ubah/hapus manual) — supaya jejaknya tidak
  // bisa "dihapus jejak"-nya sendiri lewat panel yang sama. Sengaja TIDAK dikasih fitur
  // Import/Export supaya sifat read-only-nya tetap konsisten (tidak bisa disusupi lewat import).
  const resourceAuditLog = {
    resource: db.table('audit_log'),
    options: {
      actions: {
        new: { isAccessible: false },
        edit: { isAccessible: false },
        delete: { isAccessible: false },
        bulkDelete: { isAccessible: false },
      },
    },
  }

  // ===== DASHBOARD RINGKASAN (poin 4) =====
  // Handler ini dijalankan di server, hasilnya diambil otomatis oleh komponen
  // Dashboard.jsx lewat ApiClient().getDashboard() di sisi frontend.
  async function dashboardHandler() {
    const { rows: totalUnit } = await poolAudit.query('SELECT COUNT(*)::int AS total FROM unit')
    const { rows: totalTenagaTeknik } = await poolAudit.query('SELECT COUNT(*)::int AS total FROM tenaga_teknik')
    const { rows: totalPemeliharaan } = await poolAudit.query('SELECT COUNT(*)::int AS total FROM pemeliharaan')
    const { rows: totalPemeriksaanInstalasi } = await poolAudit.query('SELECT COUNT(*)::int AS total FROM pemeriksaan_instalasi')
    const { rows: totalKajianTeknis } = await poolAudit.query('SELECT COUNT(*)::int AS total FROM kajian_teknis')
    const { rows: totalUsers } = await poolAudit.query('SELECT COUNT(*)::int AS total FROM users')

    const { rows: statusKelayakan } = await poolAudit.query(`
      SELECT COALESCE("statusKelayakan", 'Belum diisi') AS label, COUNT(*)::int AS jumlah
      FROM unit
      GROUP BY label
      ORDER BY jumlah DESC
    `)

    const { rows: statusWaktu } = await poolAudit.query(`
      SELECT
        CASE
          WHEN jatuh_tempo < NOW() THEN 'Sudah Lewat'
          WHEN jatuh_tempo <= NOW() + INTERVAL '30 days' THEN 'Mendekati Jatuh Tempo'
          ELSE 'Aman'
        END AS label,
        COUNT(*)::int AS jumlah
      FROM (
        SELECT "tanggalUjiTerakhir"::timestamp + ("jangkaWaktuBulan" * INTERVAL '1 month') AS jatuh_tempo
        FROM unit
      ) unit_dengan_tempo
      GROUP BY label
    `)

    return {
      ringkasan: {
        unit: totalUnit[0].total,
        tenagaTeknik: totalTenagaTeknik[0].total,
        pemeliharaan: totalPemeliharaan[0].total,
        pemeriksaanInstalasi: totalPemeriksaanInstalasi[0].total,
        kajianTeknis: totalKajianTeknis[0].total,
        users: totalUsers[0].total,
      },
      statusKelayakan,
      statusWaktu,
    }
  }

  const admin = new AdminJS({
    resources: [...resourceDenganAudit, resourceAuditLog],
    rootPath: '/admin',
    componentLoader,
    dashboard: {
      handler: dashboardHandler,
      component: Components.Dashboard,
    },
    branding: {
      companyName: 'Pengelolaan SPIP - SICOOL',
    },
  })

  // Login sederhana pakai 1 akun admin dari environment variable (bukan tabel "users"
  // yang dipakai user aplikasi biasa) — supaya panel admin ini terpisah aksesnya.
  const router = AdminJSExpress.buildAuthenticatedRouter(
    admin,
    {
      authenticate: async (email, password) => {
        if (email === process.env.ADMIN_EMAIL && password === process.env.ADMIN_PASSWORD) {
          return { email }
        }
        return null
      },
      cookieName: 'adminjs',
      cookiePassword: process.env.ADMIN_SESSION_SECRET,
    },
    null,
    {
      resave: false,
      saveUninitialized: false,
      secret: process.env.ADMIN_SESSION_SECRET,
    }
  )

  return { admin, router }
}

module.exports = { buatAdminRouter }