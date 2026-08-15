// Panel admin AdminJS — di-load pakai dynamic import() karena AdminJS v7 ke atas adalah
// paket ESM murni (tidak bisa dipanggil pakai require() biasa dari project CommonJS ini).
// Kalau pakai require('adminjs') langsung di level atas file, Node akan melempar error
// ERR_REQUIRE_ESM SAAT FILE INI DI-REQUIRE oleh server.js (bukan saat fungsi ini dipanggil) —
// itu sebabnya sebelumnya seluruh server crash total, bahkan sebelum sempat masuk ke
// try/catch di pasangAdminPanel() pada server.js.

async function buatAdminRouter() {
  const { default: AdminJS } = await import('adminjs')
  const { default: AdminJSExpress } = await import('@adminjs/express')
  const { Database, Resource } = await import('@adminjs/sql')

  AdminJS.registerAdapter({ Database, Resource })

  // Bikin router AdminJS yang terhubung ke database Postgres yang sama dengan backend utama.
  // Semua tabel yang ada (unit, users, pemeliharaan, tenaga_teknik, dst) otomatis kebaca
  // tanpa perlu didaftarkan satu-satu.
  const db = await new Database(
    { connectionString: process.env.DATABASE_URL, database: 'railway' },
    'postgresql'
  ).init()

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