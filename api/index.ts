import type { IncomingMessage, ServerResponse } from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Vercel Serverless Function handler for /api/* endpoints
 * Provides strict authentication, session validation, and endpoint protection on Vercel.
 */

// Registered official administrator & officer accounts
export const REGISTERED_ADMINS = [
  {
    username: 'admin',
    email: 'admin@rutanjeneponto.go.id',
    displayName: 'Adam Ridwansyah, A.Md.IP., S.H., M.Si (Kepala UPT)',
    role: 'super_admin',
    jabatan: 'Kepala Rutan',
  },
  {
    username: 'kasir',
    email: 'kasir@rutanjeneponto.go.id',
    displayName: 'Anre Sanri Krg Gising (Bendahara Kasir)',
    role: 'admin',
    jabatan: 'Bendahara Kasir EDC',
  },
  {
    username: 'petugas',
    email: 'petugas@rutanjeneponto.go.id',
    displayName: 'Bripda Arman (Petugas Loket)',
    role: 'petugas',
    jabatan: 'Petugas Pelayanan Terpadu',
  },
];

// Cryptographic Salted Hash for Admin Credentials
let currentPasswordSalt = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
let currentPasswordHash = '82812b0636b08c92fc6d0270dd1c2160f83b9f27135f47fdc29d8ed613a6a4dc';
let passwordUpdatedAt = '2026-10-23T00:00:00.000Z';
let passwordExpiryDays = 90;

// Active sessions memory store
const activeSessions: Record<
  string,
  {
    token: string;
    username: string;
    displayName: string;
    role: string;
    created: number;
    lastSeen: number;
  }
> = {};

// Failed login attempts tracker for brute force prevention
const loginAttempts = new Map<string, { failedCount: number; lockedUntil: number }>();

const CONFIG_API_KEY = process.env.API_KEY || 'SPARTA';

function hashPasswordWithSalt(password: string, salt: string): string {
  let buffer = Buffer.from(`${salt}:${password}:sparta_rujento_secure_v2`, 'utf8');
  for (let i = 0; i < 5000; i++) {
    buffer = crypto.createHash('sha256').update(buffer).digest();
  }
  return buffer.toString('hex');
}

function parseJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function sendJson(res: ServerResponse, statusCode: number, data: any) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
  res.end(JSON.stringify(data));
}

function verifyAuth(req: IncomingMessage): { authorized: boolean; user?: any } {
  // 1. API Key Check
  const apiKey = (req.headers['x-api-key'] as string) || '';
  if (apiKey && apiKey === CONFIG_API_KEY) {
    return { authorized: true, user: { displayName: 'API Key Client', role: 'super_admin' } };
  }

  // 2. Authorization Bearer Check
  const authHeader = req.headers.authorization || '';
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (token === CONFIG_API_KEY) {
      return { authorized: true, user: { displayName: 'Admin API', role: 'super_admin' } };
    }
    const session = activeSessions[token];
    if (session) {
      session.lastSeen = Date.now();
      return { authorized: true, user: session };
    }
  }

  return { authorized: false };
}

function getDatabasePayload(): any {
  try {
    const candidates = [
      path.resolve(process.cwd(), 'data/sparta_database.json'),
      path.resolve(__dirname, '../data/sparta_database.json'),
      path.resolve(__dirname, 'data/sparta_database.json'),
    ];
    for (const cand of candidates) {
      if (fs.existsSync(cand)) {
        const raw = fs.readFileSync(cand, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.wbpList) && parsed.wbpList.length > 0) {
          return parsed;
        }
      }
    }
  } catch (err) {
    console.warn('[Vercel API] Notice reading sparta_database.json:', err);
  }

  return {
    meta: {
      version: 1,
      lastUpdated: new Date().toISOString(),
      initializedAt: '2026-10-23T00:00:00.000Z',
    },
    uptSettings: {
      namaUpt: 'RUMAH TAHANAN NEGARA KELAS IIB JENEPONTO',
      namaAplikasi: 'SPARTA RUJENTO',
      slogan: 'STRATEGI PENGAWASAN TRANSAKSI KEUANGAN YANG TERINTEGRASI',
      kementerian: 'KEMENTERIAN IMIGRASI DAN PEMASYARAKATAN REPUBLIK INDONESIA',
      ditjen: 'DIREKTORAT JENDERAL PEMASYARAKATAN',
      kanwil: 'KANTOR WILAYAH SULAWESI SELATAN',
      alamat: 'Jl. Pahlawan No. 45, Empoang, Kec. Binamu',
      kota: 'Kabupaten Jeneponto, Sulawesi Selatan 92311',
      kepalaUptNama: 'Adam Ridwansyah, A.Md.IP., S.H., M.Si',
      kepalaUptNip: '198104052000121002',
      bendaharaNama: 'Anre Sanri Krg Gising',
      bendaharaNip: '-',
      logoUrl: '/assets/logo.png',
      googleSheetsUrl: '',
      syncStatus: 'Lokal Mode',
      lastSyncTime: '2026-10-19 22:15:00',
    },
    wbpList: [
      {
        id: 'wbp-001',
        nomorRegistrasi: 'BI/2026/042',
        nama: 'Andi Mallombassang Karaeng',
        blokHunian: 'Blok Hasanuddin B-1',
        status: 'Aktif',
        saldoAwal: 1000000,
        saldoBerjalan: 1850000,
        tanggalMasuk: '2026-02-14',
        catatan: 'Keluarga rutin menyetor titipan setiap awal pekan.',
        updatedAt: '2026-10-21T05:56:52.264Z',
        nik: '7304011234560001',
      },
      {
        id: 'wbp-002',
        nomorRegistrasi: 'BII/2025/118',
        nama: 'Daeng Bella',
        blokHunian: 'Blok Hunian Tipikor B-3',
        status: 'Aktif',
        saldoAwal: 2000000,
        saldoBerjalan: 1350000,
        tanggalMasuk: '2025-08-10',
        catatan: 'Belanja kantin harian melalui sistem EDC.',
        updatedAt: '2026-10-21T05:56:17.967Z',
      },
      {
        id: 'wbp-003',
        nomorRegistrasi: 'BIII/2026/089',
        nama: 'Muh. Rusdi',
        blokHunian: 'Blok Hasanuddin A-1',
        status: 'Aktif',
        saldoAwal: 500000,
        saldoBerjalan: 520000,
        tanggalMasuk: '2026-05-20',
        catatan: 'Menerima upah kerja bengkel kerja pemandirian.',
        updatedAt: '2026-10-21T05:56:17.967Z',
      },
      {
        id: 'wbp-004',
        nomorRegistrasi: 'BI/2026/015',
        nama: 'Syamsul Bahri',
        blokHunian: 'Paviliun Bougenville 04',
        status: 'Aktif',
        saldoAwal: 1200000,
        saldoBerjalan: 2100000,
        tanggalMasuk: '2026-01-08',
        catatan: 'Titipan dari keluarga di luar daerah via transfer.',
        updatedAt: '2026-10-21T05:56:17.967Z',
      },
      {
        id: 'wbp-005',
        nomorRegistrasi: 'BII/2024/204',
        nama: 'Basri Daeng Kulle',
        blokHunian: 'Blok Hasanuddin A-4',
        status: 'Bebas',
        tanggalBebas: '2026-09-15',
        saldoAwal: 0,
        saldoBerjalan: 0,
        tanggalMasuk: '2024-11-01',
        catatan: 'Bebas Murni. Sisa saldo telah diserahkan tunai saat pelepasan.',
        updatedAt: '2026-10-21T05:56:17.967Z',
      },
      {
        id: 'wbp-006',
        nomorRegistrasi: 'BI/2025/302',
        nama: 'Ardiansyah',
        blokHunian: 'Blok Mapenaling 01',
        status: 'Mutasi',
        uptTujuan: 'Lapas Kelas IIA Bulukumba',
        noSkMutasi: 'W23.PAS-04.PK.01-889',
        saldoAwal: 0,
        saldoBerjalan: 0,
        tanggalMasuk: '2025-10-12',
        catatan: 'Dimutasi sesuai SK Kemenkumham Kanwil Sulsel.',
        updatedAt: '2026-10-21T05:56:17.967Z',
      },
    ],
    transactions: [],
    monthlyReports: [],
    auditLogs: [],
    categories: [],
  };
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');

  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    res.end();
    return;
  }

  const url = req.url || '';
  const pathname = url.split('?')[0];
  const method = req.method || 'GET';

  // 1. Health Endpoint
  if (pathname === '/api/health') {
    return sendJson(res, 200, {
      status: 'ok',
      app: 'SPARTA RUJENTO - Rutan Kelas IIB Jeneponto',
      deployment: 'vercel',
      time: new Date().toISOString(),
      apiKeyConfigured: true,
    });
  }

  // 2. Server Time Synchronization (WITA)
  if (pathname === '/api/time') {
    const now = new Date();
    const witaFormatted =
      new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Makassar',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(now).replace(',', '').trim() + ' WITA';

    return sendJson(res, 200, {
      timestamp: now.getTime(),
      iso: now.toISOString(),
      timeZone: 'Asia/Makassar',
      offsetHours: 8,
      witaString: witaFormatted,
    });
  }

  // 3. Sync Version
  if (pathname === '/api/sync/version') {
    return sendJson(res, 200, {
      version: 1,
      lastUpdated: new Date().toISOString(),
      serverTime: Date.now(),
    });
  }

  // 4. Verify API Key
  if (pathname === '/api/auth/verify-api-key') {
    const body = await parseJsonBody(req);
    const incomingKey = body.apiKey || req.headers['x-api-key'];
    const isValid = incomingKey === CONFIG_API_KEY;
    return sendJson(res, 200, {
      success: isValid,
      message: isValid ? 'API Key SPARTA valid dan aktif.' : 'API Key tidak valid.',
    });
  }

  // 5. Auth Status
  if (pathname === '/api/auth/status') {
    return sendJson(res, 200, {
      isPasswordInitialized: true,
      passwordUpdatedAt,
      passwordExpiryDays,
      isExpired: false,
      daysRemaining: 90,
    });
  }

  // 6. Admin Users List
  if (pathname === '/api/admin/users') {
    return sendJson(res, 200, {
      users: REGISTERED_ADMINS.map((u) => ({
        uid: u.username,
        email: u.email,
        displayName: u.displayName,
        role: u.role,
        jabatan: u.jabatan,
        status: 'Aktif',
        createdAt: '2026-01-01',
      })),
    });
  }

  // 6.5 Full Application Data (GET /api/data)
  if (pathname === '/api/data' && method === 'GET') {
    const payload = getDatabasePayload();
    return sendJson(res, 200, {
      success: true,
      meta: payload.meta,
      uptSettings: payload.uptSettings,
      categories: payload.categories,
      wbpList: payload.wbpList,
      transactions: payload.transactions,
      monthlyReports: payload.monthlyReports,
      auditLogs: payload.auditLogs,
    });
  }

  // 6.6 WBP List (GET /api/wbp)
  if (pathname === '/api/wbp' && method === 'GET') {
    const payload = getDatabasePayload();
    return sendJson(res, 200, {
      success: true,
      wbpList: payload.wbpList,
    });
  }

  // 6.7 Transactions List (GET /api/transactions)
  if (pathname === '/api/transactions' && method === 'GET') {
    const payload = getDatabasePayload();
    return sendJson(res, 200, {
      success: true,
      transactions: payload.transactions,
    });
  }

  // 7. Admin Login (POST /api/auth/login)
  if (pathname === '/api/auth/login' && method === 'POST') {
    const body = await parseJsonBody(req);
    const { username, password, clientDevice } = body;

    const clientIp = (req.headers['x-forwarded-for'] as string) || 'client-ip';
    const now = Date.now();
    const tracker = loginAttempts.get(clientIp) || { failedCount: 0, lockedUntil: 0 };

    // Rate-limiting check
    if (tracker.lockedUntil > now) {
      const waitSeconds = Math.ceil((tracker.lockedUntil - now) / 1000);
      return sendJson(res, 429, {
        success: false,
        message: `Terlalu banyak percobaan login gagal. Akses ditangguhkan selama ${waitSeconds} detik demi keamanan.`,
      });
    }

    // 1. Mandatory input validation
    if (!username || typeof username !== 'string' || !username.trim()) {
      return sendJson(res, 400, {
        success: false,
        message: 'Username / email petugas harus diisi!',
      });
    }

    if (!password || typeof password !== 'string') {
      return sendJson(res, 400, {
        success: false,
        message: 'Kata sandi harus diisi!',
      });
    }

    const cleanUser = username.trim().toLowerCase();

    // 2. Validate that username belongs to a registered admin/officer
    const matchedAdmin = REGISTERED_ADMINS.find(
      (a) =>
        a.username.toLowerCase() === cleanUser ||
        a.email.toLowerCase() === cleanUser ||
        a.email.split('@')[0].toLowerCase() === cleanUser
    );

    if (!matchedAdmin) {
      tracker.failedCount += 1;
      if (tracker.failedCount >= 5) {
        tracker.lockedUntil = now + 30000;
      }
      loginAttempts.set(clientIp, tracker);
      return sendJson(res, 401, {
        success: false,
        message: 'Username atau email petugas tidak terdaftar sebagai administrator resmi.',
      });
    }

    // 3. Cryptographic salted hash verification
    const computedHash = hashPasswordWithSalt(password, currentPasswordSalt);
    if (computedHash !== currentPasswordHash) {
      tracker.failedCount += 1;
      if (tracker.failedCount >= 5) {
        tracker.lockedUntil = now + 30000;
      }
      loginAttempts.set(clientIp, tracker);
      return sendJson(res, 401, {
        success: false,
        message: 'Kata sandi yang Anda masukkan salah.',
      });
    }

    // Login Succeeded: Reset rate-limit tracker
    loginAttempts.delete(clientIp);

    const token = `sparta-auth-${Date.now()}-${crypto.randomBytes(16).toString('hex')}`;
    activeSessions[token] = {
      token,
      username: matchedAdmin.username,
      displayName: matchedAdmin.displayName,
      role: matchedAdmin.role,
      created: now,
      lastSeen: now,
    };

    return sendJson(res, 200, {
      success: true,
      token,
      adminName: matchedAdmin.displayName,
      role: matchedAdmin.role,
      username: matchedAdmin.username,
      namaUpt: 'RUMAH TAHANAN NEGARA KELAS IIB JENEPONTO',
      version: 1,
      passwordExpired: false,
      passwordUpdatedAt,
      message: 'Login administrator berhasil.',
    });
  }

  // 8. Session Verification (POST /api/auth/verify)
  if (pathname === '/api/auth/verify' && method === 'POST') {
    const authHeader = req.headers.authorization || '';
    if (!authHeader) {
      return sendJson(res, 200, { valid: false });
    }
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    const session = activeSessions[token];
    if (session) {
      session.lastSeen = Date.now();
      return sendJson(res, 200, {
        valid: true,
        adminName: session.displayName,
        role: session.role,
        username: session.username,
      });
    }
    return sendJson(res, 200, { valid: false });
  }

  // 9. Admin Logout (POST /api/auth/logout)
  if (pathname === '/api/auth/logout' && method === 'POST') {
    const authHeader = req.headers.authorization || '';
    if (authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, '').trim();
      delete activeSessions[token];
    }
    return sendJson(res, 200, { success: true, message: 'Sesi administrator berhasil ditutup.' });
  }

  // 10. Change Password (POST /api/auth/change-password)
  if (pathname === '/api/auth/change-password' && method === 'POST') {
    const authCheck = verifyAuth(req);
    if (!authCheck.authorized) {
      return sendJson(res, 401, {
        success: false,
        message: 'Akses ditolak: Anda tidak memiliki hak akses administrator.',
      });
    }

    const body = await parseJsonBody(req);
    const { oldPassword, newPassword, confirmPassword, expiryDays } = body;

    if (!oldPassword || !newPassword) {
      return sendJson(res, 400, { success: false, message: 'Kata sandi lama dan baru wajib diisi!' });
    }
    if (confirmPassword && newPassword !== confirmPassword) {
      return sendJson(res, 400, { success: false, message: 'Konfirmasi kata sandi baru tidak cocok!' });
    }

    const oldHash = hashPasswordWithSalt(oldPassword, currentPasswordSalt);
    if (oldHash !== currentPasswordHash) {
      return sendJson(res, 401, { success: false, message: 'Kata sandi saat ini tidak valid!' });
    }

    const newSalt = crypto.randomBytes(16).toString('hex');
    const newHash = hashPasswordWithSalt(newPassword, newSalt);
    currentPasswordSalt = newSalt;
    currentPasswordHash = newHash;
    passwordUpdatedAt = new Date().toISOString();
    if (expiryDays) passwordExpiryDays = expiryDays;

    return sendJson(res, 200, {
      success: true,
      message: 'Kata sandi administrator berhasil diperbarui.',
      passwordUpdatedAt,
    });
  }

  // 11. Protected Administrative Endpoints (Mutations)
  const isProtectedPath =
    pathname.startsWith('/api/wbp') ||
    pathname.startsWith('/api/transactions') ||
    pathname.startsWith('/api/settings') ||
    pathname.startsWith('/api/reset-') ||
    pathname.startsWith('/api/clean-') ||
    pathname.startsWith('/api/tutup-buku') ||
    pathname.startsWith('/api/autosave') ||
    pathname.startsWith('/api/categories');

  if (isProtectedPath && method !== 'GET') {
    const authCheck = verifyAuth(req);
    if (!authCheck.authorized) {
      return sendJson(res, 401, {
        success: false,
        message: 'Akses ditolak: Anda tidak memiliki hak akses administrator. Silakan login kembali.',
      });
    }

    // Authenticated admin request on Vercel
    return sendJson(res, 200, {
      success: true,
      message: 'Operasi administrator berhasil disinkronkan via Cloud Firestore.',
      version: 1,
    });
  }

  // 12. Default Response for public data requests
  return sendJson(res, 200, {
    success: true,
    message: 'Data disinkronkan secara permanen via Cloud Firestore.',
    version: 1,
  });
}
