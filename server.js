import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import cors from 'cors';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const app = express();
const PORT = process.env.PORT || 10000;

// 미들웨어
app.use(cors());
app.use(express.json());

// 캐시 방지 미들웨어
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// DB 연결 설정 (성능 최적화)
const dbConfig = {
  host: process.env.DB_HOST || 'pulley-cluster.cluster-ce1us4oyptfa.ap-northeast-2.rds.amazonaws.com',
  user: process.env.DB_USER || 'statisticuser',
  password: process.env.DB_PASSWORD || 'pulley1234',
  database: process.env.DB_NAME || 'pulley',
  port: parseInt(process.env.DB_PORT || '3306'),
  waitForConnections: true,
  connectionLimit: 20, // 연결 수 증가
  queueLimit: 0,
  acquireTimeout: 10000, // 연결 획득 타임아웃 10초
  timeout: 10000, // 쿼리 타임아웃 10초
  reconnect: true, // 자동 재연결
  idleTimeout: 300000, // 유휴 연결 타임아웃 5분
  timezone: '+09:00', // 한국 시간대 설정
};

// DB 연결 풀 생성
const pool = mysql.createPool(dbConfig);

// DB 연결 풀 워밍업 (서버 시작 시 미리 연결)
const warmupDB = async () => {
  try {
    console.log('DB 연결 풀 워밍업 시작...');
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    console.log('DB 연결 풀 워밍업 완료');
  } catch (error) {
    console.error('DB 워밍업 실패:', error);
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
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.execute('SELECT 1 as test');
    connection.release();
    
    res.json({ 
      success: true, 
      message: 'Database connection successful',
      data: rows,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Database connection error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Database connection failed',
      error: error.message 
    });
  }
});

// API 라우트들
import authRoutes from './routes/auth.js';
import universitiesRoutes from './routes/universities.js';
import dataRoutes from './routes/data.js';

app.use('/api/auth', authRoutes(pool, JWT_SECRET));
app.use('/api/universities', universitiesRoutes(pool));
app.use('/api/data', dataRoutes(pool));

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
