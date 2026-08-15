// Panel admin AdminJS — di-load pakai dynamic import() karena AdminJS v7 ke atas adalah
// paket ESM murni (tidak bisa dipanggil pakai require() biasa dari project CommonJS ini).
// Kalau pakai require('adminjs') langsung di level atas file, Node akan melempar error
// ERR_REQUIRE_ESM SAAT FILE INI DI-REQUIRE oleh server.js (bukan saat fungsi ini dipanggil) —
// itu sebabnya sebelumnya seluruh server crash total, bahkan sebelum sempat masuk ke
// try/catch di pasangAdminPanel() pada server.js.

const { Pool } = require('pg')

// Daftar tabel yang didaftarkan manual satu-satu (bukan pakai "databases: [db]" auto-register
// lagi), supaya tiap tabel bisa dikasih hook audit log sendiri-sendiri. Kalau nanti nambah
// tabel baru di server.js, tambahkan juga nama tabelnya di sini supaya ikut muncul di panel
// admin dan (kalau relevan) ikut tercatat di audit log.
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
  const { default: AdminJS } = await import('adminjs')
  const { default: AdminJSExpress } = await import('@adminjs/express')
  // PENTING: class yang harus di-instansiasi & dipanggil .init() adalah "Adapter"
  // (default export dari @adminjs/sql), BUKAN "Database". "Database" dan "Resource"
  // di sini cuma dipakai untuk AdminJS.registerAdapter — mereka adalah class internal
  // yang dipakai Adapter di belakang layar, bukan untuk dipanggil manual.
  const { default: Adapter, Database, Resource } = await import('@adminjs/sql')

  AdminJS.registerAdapter({ Database, Resource })

  const db = await new Adapter('postgresql', {
    connectionString: process.env.DATABASE_URL,
    database: 'railway',
  }).init()

  // Pool koneksi TERPISAH khusus untuk menulis ke tabel audit_log dari dalam hook —
  // dibuat sendiri (bukan pinjam dari server.js) supaya admin.js tetap mandiri/tidak
  // perlu server.js mengoper pool sebagai parameter.
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

  // Tabel-tabel biasa: didaftarkan manual + dikasih hook audit.
  const resourceDenganAudit = DAFTAR_TABEL_DIAUDIT.map((namaTabel) => ({
    resource: db.table(namaTabel),
    options: {
      actions: buatHookAudit(namaTabel),
    },
  }))

  // Tabel audit_log itu sendiri: didaftarkan juga supaya bisa DILIHAT di panel admin,
  // tapi dibuat READ-ONLY (tidak bisa tambah/ubah/hapus manual) — supaya jejaknya tidak
  // bisa "dihapus jejak"-nya sendiri lewat panel yang sama.
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

  const admin = new AdminJS({
    resources: [...resourceDenganAudit, resourceAuditLog],
    rootPath: '/admin',
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