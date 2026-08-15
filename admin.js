const AdminJS = require('adminjs').default
const AdminJSExpress = require('@adminjs/express')
const { Database, Resource } = require('@adminjs/sql')

AdminJS.registerAdapter({ Database, Resource })

// Bikin router AdminJS yang terhubung ke database Postgres yang sama dengan backend utama.
// Semua tabel yang ada (unit, users, pemeliharaan, tenaga_teknik, dst) otomatis kebaca
// tanpa perlu didaftarkan satu-satu.
async function buatAdminRouter() {
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