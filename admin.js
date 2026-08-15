// Panel admin AdminJS — di-load pakai dynamic import() karena AdminJS v7 ke atas adalah
// paket ESM murni (tidak bisa dipanggil pakai require() biasa dari project CommonJS ini).
// Kalau pakai require('adminjs') langsung di level atas file, Node akan melempar error
// ERR_REQUIRE_ESM SAAT FILE INI DI-REQUIRE oleh server.js (bukan saat fungsi ini dipanggil) —
// itu sebabnya sebelumnya seluruh server crash total, bahkan sebelum sempat masuk ke
// try/catch di pasangAdminPanel() pada server.js.

async function buatAdminRouter() {
  const { default: AdminJS } = await import('adminjs')
  const { default: AdminJSExpress } = await import('@adminjs/express')
  const sqlModule = await import('@adminjs/sql')

  // DIAGNOSTIK SEMENTARA: cetak bentuk asli module @adminjs/sql supaya kita tahu persis
  // nama export yang benar (Database bisa saja ada di sqlModule.default.Database, bukan
  // langsung di sqlModule.Database, tergantung cara package ini di-build).
  console.log("DEBUG @adminjs/sql module keys:", Object.keys(sqlModule))
  if (sqlModule.default) {
    console.log("DEBUG @adminjs/sql default keys:", Object.keys(sqlModule.default))
  }

  // Coba ambil Database & Resource dari kedua kemungkinan lokasi (named export ATAU
  // dibungkus di dalam .default), supaya tetap jalan apa pun bentuk exportnya.
  const Database = sqlModule.Database || sqlModule.default?.Database
  const Resource = sqlModule.Resource || sqlModule.default?.Resource

  console.log("DEBUG typeof Database:", typeof Database)
  console.log("DEBUG Database.prototype keys:", Database ? Object.getOwnPropertyNames(Database.prototype || {}) : "Database undefined")

  if (typeof Database !== 'function') {
    throw new Error(`Database bukan constructor yang valid (typeof: ${typeof Database}). Cek log DEBUG di atas untuk bentuk export @adminjs/sql yang sebenarnya.`)
  }

  AdminJS.registerAdapter({ Database, Resource })

  // Bikin instance Database. Dipisah dari .init() supaya kalau .init() memang tidak ada,
  // errornya lebih jelas menyebutkan bagian mana yang gagal.
  const dbInstance = new Database(
    { connectionString: process.env.DATABASE_URL, database: 'railway' },
    'postgresql'
  )

  console.log("DEBUG typeof dbInstance.init:", typeof dbInstance.init)

  const db = typeof dbInstance.init === 'function'
    ? await dbInstance.init()
    : dbInstance // fallback: kalau versi ini tidak butuh .init(), instance-nya langsung dipakai

  const admin = new AdminJS({
    resources: db.tables().map((table) => ({ resource: table, options: {} })),
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