import express from 'express';
import cors from 'cors';
import mysql from 'mysql2/promise';

const app = express();
const PORT = process.env.PORT || 10000;

// CORS 설정
app.use(cors({
  origin: function (origin, callback) {
    // 로컬 개발 환경 허용
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'http://localhost:3000',
      'https://university-learning-dashboard.vercel.app',
      'https://university-learning-dashboard-git-main-donghun1994.vercel.app'
    ];
    
    // Vercel 서브도메인 허용
    if (origin.includes('.vercel.app')) {
      return callback(null, true);
    }
    
    // 허용된 origin 목록에 있는지 확인
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'Pragma', 'X-Requested-With']
}));

// 미들웨어
app.use(express.json());

// OPTIONS 요청 처리
app.options('*', (req, res) => {
  res.status(200).end();
});

// 캐시 방지 미들웨어
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// DB 연결 설정 (성능 최적화)
// Connection 옵션 (실제 DB 연결 설정)
const connectionConfig = {
  host: process.env.DB_HOST || 'pulley-cluster.cluster-ce1us4oyptfa.ap-northeast-2.rds.amazonaws.com',
  user: process.env.DB_USER || 'statisticuser',
  password: process.env.DB_PASSWORD || 'pulley1234',
  database: process.env.DB_NAME || 'pulley',
  port: parseInt(process.env.DB_PORT || '3306'),
  timezone: '+09:00', // 한국 시간대 설정
  connectTimeout: 60000, // 연결 타임아웃 60초 (Render.com 네트워크 지연 대응)
  // SSL 설정 (RDS는 SSL을 요구할 수 있음)
  ssl: process.env.DB_SSL === 'true' ? {
    rejectUnauthorized: false // 자체 서명 인증서 허용
  } : false,
  // 연결 옵션
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
};

// Pool 옵션 (연결 풀 설정)
const poolConfig = {
  ...connectionConfig,
  waitForConnections: true,
  connectionLimit: 20, // 연결 수 증가
  queueLimit: 0,
  acquireTimeout: 60000, // 연결 획득 타임아웃 60초
  idleTimeout: 300000, // 유휴 연결 타임아웃 5분
};

// DB 연결 풀 생성
const pool = mysql.createPool(poolConfig);

// DB 연결 풀 워밍업 (서버 시작 시 미리 연결)
const warmupDB = async () => {
  let retries = 3;
  let delay = 2000; // 2초
  
  console.log('DB 연결 설정:', {
    host: connectionConfig.host,
    port: connectionConfig.port,
    database: connectionConfig.database,
    user: connectionConfig.user,
    connectTimeout: connectionConfig.connectTimeout,
    ssl: connectionConfig.ssl ? 'enabled' : 'disabled'
  });
  
  for (let i = 0; i < retries; i++) {
    try {
      console.log(`DB 연결 풀 워밍업 시작... (시도 ${i + 1}/${retries})`);
      const startTime = Date.now();
      const connection = await pool.getConnection();
      await connection.ping();
      const duration = Date.now() - startTime;
      connection.release();
      console.log(`DB 연결 풀 워밍업 완료 (소요 시간: ${duration}ms)`);
      return;
    } catch (error) {
      console.error(`DB 워밍업 실패 (시도 ${i + 1}/${retries}):`, error.message);
      console.error('에러 상세:', {
        code: error.code,
        errno: error.errno,
        sqlState: error.sqlState,
        sqlMessage: error.sqlMessage,
        syscall: error.syscall,
        address: error.address,
        port: error.port
      });
      
      if (i < retries - 1) {
        console.log(`${delay}ms 후 재시도...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; // 지수 백오프
      } else {
        console.error('DB 워밍업 최종 실패 - 서버는 시작되지만 DB 연결이 필요할 때 다시 시도됩니다.');
        console.error('⚠️  RDS 보안 그룹에서 Render.com IP를 허용했는지 확인하세요.');
      }
    }
  }
};

// 서버 시작 시 DB 워밍업 실행
warmupDB();

// JWT 시크릿
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// 헬스 체크
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });
});

// DB 연결 테스트
app.get('/db-test', async (req, res) => {
  let connection;
  try {
    console.log('DB 연결 테스트 시작...');
    const startTime = Date.now();
    connection = await pool.getConnection();
    const [rows] = await connection.execute('SELECT 1 as test');
    const duration = Date.now() - startTime;
    connection.release();
    
    console.log(`DB 연결 성공 (소요 시간: ${duration}ms)`);
    res.json({ 
      success: true, 
      message: 'Database connection successful',
      data: rows,
      duration: `${duration}ms`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    if (connection) connection.release();
    console.error('Database connection error:', error);
    console.error('에러 상세:', {
      code: error.code,
      errno: error.errno,
      sqlState: error.sqlState,
      sqlMessage: error.sqlMessage,
      message: error.message,
      syscall: error.syscall,
      address: error.address,
      port: error.port
    });
    res.status(500).json({ 
      success: false, 
      message: 'Database connection failed',
      error: error.message,
      code: error.code,
      errno: error.errno
    });
  }
});

// API 라우트들 (순서가 중요함 - * 라우트보다 앞에 배치)
import authRoutes from './routes/auth.js';
import universitiesRoutes from './routes/universities.js';
import dataRoutes from './routes/data.js';
import piecesRoutes from './routes/pieces.js';

app.use('/api/auth', authRoutes(pool, JWT_SECRET));
app.use('/api/universities', universitiesRoutes(pool));
app.use('/api/data', dataRoutes(pool));
app.use('/api/pieces', piecesRoutes(pool));

// API가 아닌 요청에 대한 기본 응답
app.get('*', (req, res) => {
  res.json({ 
    message: 'This is a proxy server for API endpoints only. Please access the frontend at the Vercel URL.',
    availableEndpoints: [
      '/api/auth/login',
      '/api/auth/logout', 
      '/api/auth/me',
      '/api/universities',
      '/api/data/*',
      '/api/pieces/*',
      '/health',
      '/db-test'
    ]
  });
});

app.listen(PORT, () => {
  console.log(`Proxy server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`DB test: http://localhost:${PORT}/db-test`);
});
