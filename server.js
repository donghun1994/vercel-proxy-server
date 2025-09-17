const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 10000;

// 미들웨어
app.use(cors());
app.use(express.json());

// DB 연결 설정
const dbConfig = {
  host: process.env.DB_HOST || 'pulley-cluster.cluster-ce1us4oyptfa.ap-northeast-2.rds.amazonaws.com',
  user: process.env.DB_USER || 'statisticuser',
  password: process.env.DB_PASSWORD || 'pulley1234',
  database: process.env.DB_NAME || 'pulley',
  port: parseInt(process.env.DB_PORT || '3306'),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

// DB 연결 풀 생성
const pool = mysql.createPool(dbConfig);

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
app.use('/api/auth', require('./routes/auth')(pool, JWT_SECRET));
app.use('/api/universities', require('./routes/universities')(pool));
app.use('/api/data', require('./routes/data')(pool));

// Vercel 앱으로 프록시 (정적 파일들)
app.use('/', createProxyMiddleware({
  target: process.env.VERCEL_URL || 'https://university-learning-dashboard.vercel.app',
  changeOrigin: true,
  pathRewrite: {
    '^/api': '/api' // API는 로컬에서 처리
  },
  onError: (err, req, res) => {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Proxy error' });
  }
}));

app.listen(PORT, () => {
  console.log(`Proxy server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`DB test: http://localhost:${PORT}/db-test`);
});
