import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export default (pool, JWT_SECRET) => {
  const router = express.Router();

  // 로그인
  router.post('/login', async (req, res) => {
    let connection;
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          message: '이메일과 비밀번호를 입력해주세요.'
        });
      }

      // 연결 풀에서 연결 획득 (재사용 가능)
      connection = await pool.getConnection();
      
      // 사용자 조회 (인덱스 최적화)
      const [users] = await connection.execute(
        'SELECT id, email, password, role, name FROM user WHERE email = ? AND role = "admin" LIMIT 1',
        [email]
      );

      if (users.length === 0) {
        if (connection) connection.release();
        return res.status(401).json({
          success: false,
          message: '유효하지 않은 이메일 또는 비밀번호입니다.'
        });
      }

      const user = users[0];

      // 비밀번호 확인
      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        if (connection) connection.release();
        return res.status(401).json({
          success: false,
          message: '유효하지 않은 이메일 또는 비밀번호입니다.'
        });
      }

      // 연결 해제
      if (connection) connection.release();

      // JWT 토큰 생성
      const token = jwt.sign(
        { id: user.id, email: user.email, role: user.role },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      res.json({
        success: true,
        message: '로그인 성공',
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role
        }
      });

    } catch (error) {
      console.error('Login error:', error);
      if (connection) connection.release();
      res.status(500).json({
        success: false,
        message: '로그인 중 오류가 발생했습니다.'
      });
    }
  });

  // 로그아웃
  router.post('/logout', (req, res) => {
    res.json({
      success: true,
      message: '로그아웃 성공'
    });
  });

  // 사용자 정보 조회
  router.get('/me', async (req, res) => {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      
      if (!token) {
        return res.status(401).json({
          success: false,
          message: '토큰이 필요합니다.'
        });
      }

      const decoded = jwt.verify(token, JWT_SECRET);
      
      // 사용자 정보 조회
      const [users] = await pool.execute(
        'SELECT id, email, role, name FROM user WHERE id = ?',
        [decoded.id]
      );

      if (users.length === 0) {
        return res.status(404).json({
          success: false,
          message: '사용자를 찾을 수 없습니다.'
        });
      }

      res.json({
        success: true,
        user: users[0]
      });

    } catch (error) {
      console.error('Get user error:', error);
      res.status(401).json({
        success: false,
        message: '유효하지 않은 토큰입니다.'
      });
    }
  });

  return router;
};
