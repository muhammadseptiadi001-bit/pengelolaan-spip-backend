// Panel admin AdminJS — di-load pakai dynamic import() karena AdminJS v7 ke atas adalah
// paket ESM murni (tidak bisa dipanggil pakai require() biasa dari project CommonJS ini).
// Kalau pakai require('adminjs') langsung di level atas file, Node akan melempar error
// ERR_REQUIRE_ESM SAAT FILE INI DI-REQUIRE oleh server.js (bukan saat fungsi ini dipanggil) —
// itu sebabnya sebelumnya seluruh server crash total, bahkan sebelum sempat masuk ke
// try/catch di pasangAdminPanel() pada server.js.

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

  const admin = new AdminJS({
    // "databases: [db]" otomatis mendaftarkan SEMUA tabel yang ada di database ini
    // sekaligus (unit, users, pemeliharaan, tenaga_teknik, dst) tanpa perlu didaftarkan
    // satu-satu lewat db.table('nama_tabel').
    databases: [db],
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