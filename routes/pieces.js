import express from 'express';
import axios from 'axios';
import sharp from 'sharp';
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  ImageRun,
  PageOrientation,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
} from 'docx';

const piecesRoutes = (pool) => {
  const router = express.Router();

  // ---------- 공통 유틸 ----------
  const safeFilename = (name) =>
    String(name).replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 150);

  function* pairRows(rows) {
    for (let i = 0; i < rows.length; i++) {
      yield {
        idx: i + 1,
        problemUrl: rows[i].problem_img_url || null,
        solutionUrl: rows[i].solution_img_url || null,
      };
    }
  }

  // 이미지 로드 + 검증 + 리사이즈 + PNG로 통일
  // 반환: { buffer, width, height } | null
  async function loadPreparePng(url, { maxW = 520, maxH = 680 }) {
    try {
      const resp = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 15000,
        headers: { 'User-Agent': 'Mozilla/5.0' },
        validateStatus: (s) => s >= 200 && s < 300,
      });

      let buf = Buffer.from(resp.data);
      if (!buf?.length) throw new Error('empty-bytes');

      // 간단한 시그니처 검사 (png/jpg만 허용)
      const isPNG =
        buf.length >= 8 &&
        buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]));
      const isJPG = buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8;
      if (!isPNG && !isJPG) throw new Error('not-png-or-jpg');

      let img = sharp(buf, { failOnError: false });
      let meta = await img.metadata();
      if (!meta.width || !meta.height) throw new Error('bad-metadata');

      // 비율 유지 리사이즈
      let w = meta.width, h = meta.height;
      const ratio = Math.min(maxW / w, maxH / h, 1);
      w = Math.max(1, Math.floor(w * ratio));
      h = Math.max(1, Math.floor(h * ratio));

      // ★ PNG로 통일
      buf = await img
        .resize(w, h, { fit: 'inside', withoutEnlargement: true })
        .png({ compressionLevel: 9 })
        .toBuffer();

      return { buffer: buf, width: w, height: h };
    } catch (e) {
      console.warn('image prepare failed:', url, e.message);
      return null;
    }
  }

  // ---------- 사용자별 학습지 조회 ----------
  router.get('/user-pieces', async (req, res) => {
    try {
      const { email } = req.query;
      if (!email) return res.status(400).json({ success: false, message: '이메일을 입력해주세요.' });

      const [userResult] = await pool.execute(
        `SELECT hu.id
           FROM htht_university_user hu
           LEFT JOIN user u ON hu.user_id = u.student_id
          WHERE u.account_email = ?`,
        [email]
      );
      if (userResult.length === 0) return res.json({ success: true, data: [] });

      const htht_university_user_id = userResult[0].id;
      const subjects = ['math','science','japanese','english','korean','medicine','native_korean','it','biz_eco'];

      const out = [];
      for (const subject of subjects) {
        const [rows] = await pool.execute(
          `SELECT '${subject}' AS subject, p.id, i.title, DATE_FORMAT(p.created_at, '%Y-%m-%d') AS created_at
             FROM ${subject}_piece p
             LEFT JOIN ${subject}_piece_info i ON p.piece_info_id = i.id
            WHERE p.is_deleted = 0 AND htht_university_user_id = ?
            ORDER BY p.created_at DESC`,
          [htht_university_user_id]
        );
        out.push(...rows);
      }
      res.json({ success: true, data: out });
    } catch (e) {
      console.error('Get user pieces error:', e);
      res.status(500).json({ success: false, message: '학습지 조회 중 오류가 발생했습니다.' });
    }
  });

  // ---------- 이미지 URL 조회 ----------
  router.get('/:subject/:pieceId/images', async (req, res) => {
    try {
      const { subject, pieceId } = req.params;
      const [rows] = await pool.execute(
        `SELECT jp.problem_img_url, jp.solution_img_url
           FROM ${subject}_piece p
           LEFT JOIN ${subject}_piece_info i ON p.piece_info_id = i.id
           LEFT JOIN ${subject}_piece_problem pp ON p.id = pp.piece_id
           LEFT JOIN ${subject}_problem jp ON pp.problem_id = jp.id
          WHERE p.is_deleted = 0
            AND pp.is_deleted = 0
            AND p.id = ?
          ORDER BY pp.seq`,
        [pieceId]
      );

      res.json({
        success: true,
        data: {
          problem_img_urls: rows.map(r => r.problem_img_url).filter(Boolean),
          solution_img_urls: rows.map(r => r.solution_img_url).filter(Boolean),
        },
      });
    } catch (e) {
      console.error('Get images error:', e);
      res.status(500).json({ success: false, message: '이미지 조회 중 오류가 발생했습니다.' });
    }
  });

  // ---------- Word 생성(가로/페어/자동회전/PNG고정) ----------
  router.post('/:subject/:pieceId/word', async (req, res) => {
    try {
      const { subject, pieceId } = req.params;
      const { title } = req.body || {};
      if (!title) return res.status(400).json({ success: false, message: '제목을 입력해주세요.' });

      const [rows] = await pool.execute(
        `SELECT pp.seq, jp.problem_img_url, jp.solution_img_url
           FROM ${subject}_piece p
           LEFT JOIN ${subject}_piece_info i   ON p.piece_info_id = i.id
           LEFT JOIN ${subject}_piece_problem pp ON p.id = pp.piece_id
           LEFT JOIN ${subject}_problem jp     ON pp.problem_id = jp.id
          WHERE p.is_deleted = 0
            AND pp.is_deleted = 0
            AND p.id = ?
          ORDER BY pp.seq`,
        [pieceId]
      );
      if (rows.length === 0) return res.status(404).json({ success: false, message: '문제 또는 해설 이미지가 없습니다.' });

      const children = [];
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: title, bold: true, size: 32 })],
        }),
      );
      children.push(new Paragraph({ children: [new TextRun({ text: '' })] }));

      const MAX_W = 520;
      const MAX_H = 680;

      for (const { idx, problemUrl, solutionUrl } of pairRows(rows)) {
        // 페이지 나눔: 문단 속성으로 안전하게
        const titleParaProps = { children: [new TextRun({ text: `문제 ${idx}`, bold: true, size: 24 })] };
        if (idx > 1) titleParaProps.pageBreakBefore = true;
        children.push(new Paragraph(titleParaProps));
        children.push(new Paragraph({ children: [new TextRun({ text: '' })] }));

        // 문제 셀
        const problemCellChildren = [
          new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '[문제]', bold: true, size: 18 })] }),
        ];
        if (problemUrl) {
          const p = await loadPreparePng(problemUrl, { maxW: MAX_W, maxH: MAX_H });
          if (p) {
            problemCellChildren.push(
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new ImageRun({
                    data: p.buffer,
                    transformation: { width: p.width, height: p.height },
                    type: 'png',                 // ★ 형식 명시
                  }),
                ],
              })
            );
          } else {
            problemCellChildren.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '[문제] 이미지 로드 실패', color: 'FF0000' })] }));
          }
        } else {
          problemCellChildren.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '[문제] 이미지 없음' })] }));
        }

        // 해설 셀
        const solutionCellChildren = [
          new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '[해설]', bold: true, size: 18 })] }),
        ];
        if (solutionUrl) {
          const s = await loadPreparePng(solutionUrl, { maxW: MAX_W, maxH: MAX_H });
          if (s) {
            solutionCellChildren.push(
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new ImageRun({
                    data: s.buffer,
                    transformation: { width: s.width, height: s.height },
                    type: 'png',               // ★ 형식 명시
                  }),
                ],
              })
            );
          } else {
            solutionCellChildren.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '[해설] 이미지 로드 실패', color: 'FF0000' })] }));
          }
        } else {
          solutionCellChildren.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '[해설] 이미지 없음' })] }));
        }

        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    children: problemCellChildren,
                    borders: { top: { style: BorderStyle.SINGLE }, bottom: { style: BorderStyle.SINGLE }, left: { style: BorderStyle.SINGLE }, right: { style: BorderStyle.SINGLE } },
                  }),
                  new TableCell({
                    children: solutionCellChildren,
                    borders: { top: { style: BorderStyle.SINGLE }, bottom: { style: BorderStyle.SINGLE }, left: { style: BorderStyle.SINGLE }, right: { style: BorderStyle.SINGLE } },
                  }),
                ],
              }),
            ],
          })
        );

        children.push(new Paragraph({ children: [new TextRun({ text: '' })] }));
      }

      const doc = new Document({
        creator: 'PulleyCampus',
        title,
        description: '학습지 Word 문서',
        sections: [
          {
            properties: {
              page: {
                size: { orientation: PageOrientation.LANDSCAPE },
                margin: { top: 720, right: 720, bottom: 720, left: 720 }, // 0.5"
              },
            },
            children,
          },
        ],
      });

      const buffer = await Packer.toBuffer(doc);

      const filename = `${safeFilename(title)}.docx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      res.setHeader('Cache-Control', 'no-transform'); // 중간 변환 방지
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Length', String(buffer.length)); // 길이 명시
      res.end(buffer);
    } catch (e) {
      console.error('Word generation error:', e);
      res.status(500).json({ success: false, message: 'Word 문서 생성 중 오류가 발생했습니다.' });
    }
  });

  return router;
};

export default piecesRoutes;
