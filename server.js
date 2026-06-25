import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import axios from 'axios';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import { normalizeRequestedCount } from './scanConfig.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDir = path.join(__dirname, 'uploads');

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const app = express();
const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 10 * 1024 * 1024 },
});

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadDir));

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

const parseBookCandidates = (content) => {
  try {
    const parsed = JSON.parse(content);
    const rawBooks = Array.isArray(parsed.books) ? parsed.books : [];

    const books = rawBooks
      .map((item) => ({
        title: typeof item?.title === 'string' ? item.title.trim() : '',
        author: typeof item?.author === 'string' ? item.author.trim() : '',
        confidence: ['high', 'medium', 'low'].includes(item?.confidence) ? item.confidence : 'medium',
        isbn: typeof item?.isbn === 'string' ? item.isbn.replace(/[^\d]/g, '') || null : null,
      }))
      .filter((item) => item.title.length > 0)
      .map((item) => ({
        title: item.title.replace(/\s+/g, ' '),
        author: item.author ? item.author.replace(/\s+/g, ' ') : '著者情報なし',
        confidence: item.confidence,
        isbn: item.isbn,
      }))
      .filter((item) => /[ぁ-んァ-ン一-龥]/.test(item.title) || /[ぁ-んァ-ン一-龥]/.test(item.author));

    return books.slice(0, 20);
  } catch {
    return [];
  }
};

const inferBookCandidatesFromImage = async (filePath) => {
  if (!openai) {
    return [];
  }

  try {
    const buffer = fs.readFileSync(filePath);
    const base64 = buffer.toString('base64');
    const extension = path.extname(filePath).toLowerCase();
    const mime = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';

    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: '本棚の写真から日本語書籍を識別するアシスタントです。背表紙のテキストを読み取るだけでなく、本の色・サイズ・デザイン・出版社ロゴ・シリーズの文脈なども活用して、できるだけ多くの本を特定してください。',
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `この本棚の画像に写っている書籍をできるだけ多く特定してください。

以下の情報をすべて活用してください：
- 背表紙に見えるタイトル・著者名のテキスト（縦書きが多いので注意）
- 本の色・サイズ・デザインパターン
- 出版社のロゴや装丁の特徴
- 隣の巻が見えている場合はシリーズの文脈
- ISBNバーコードが読み取れる場合はそのまま記載

各書籍について confidence を以下の基準で設定してください：
- high: タイトルと著者をはっきり読み取れる
- medium: タイトルは読めるが著者が不明、または一部しか見えない
- low: テキストは見えないが色・サイズ・デザインから推測できる

JSON形式で返してください：
{"books": [{"title": "タイトル", "author": "著者名", "confidence": "high/medium/low", "isbn": "ISBNが読めれば記載、なければnull"}]}

著者が読み取れない場合は "著者情報なし" としてください。`,
            },
            {
              type: 'image_url',
              image_url: { url: `data:${mime};base64,${base64}` },
            },
          ],
        },
      ],
    });

    const content = completion.choices?.[0]?.message?.content || '{}';
    return parseBookCandidates(content);
  } catch (error) {
    console.error('Image LLM parsing failed', error.message);
    return [];
  }
};

const searchGoogleBooks = async (query, preferredAuthor = null) => {
  try {
    const response = await axios.get('https://www.googleapis.com/books/v1/volumes', {
      params: { q: `${query} 日本語`, langRestrict: 'ja', maxResults: 6 },
      timeout: 10000,
    });

    return (response.data.items || []).map((item) => {
      const info = item.volumeInfo || {};
      const title = info.title || query;
      const author = info.authors?.join(', ') || preferredAuthor || '著者情報なし';
      const language = (info.language || '').toLowerCase();
      const hasJapanese = /[ぁ-んァ-ン一-龥]/.test(title) || /[ぁ-んァ-ン一-龥]/.test(author);

      if (language && language !== 'ja') return null;
      if (!hasJapanese) return null;

      const isbn = info.industryIdentifiers?.find((id) => id.type === 'ISBN_13')?.identifier
        || info.industryIdentifiers?.find((id) => id.type === 'ISBN_10')?.identifier
        || null;

      return {
        title,
        author,
        thumbnail: info.imageLinks?.thumbnail?.replace(/^http:\/\//, 'https://') || null,
        googleBookId: item.id,
        isbn,
        source: 'google',
      };
    }).filter(Boolean);
  } catch (error) {
    console.error('Google Books lookup failed', error.message);
    return [];
  }
};

const searchOpenBD = async (isbn) => {
  try {
    const response = await axios.get('https://api.openbd.jp/v1/get', {
      params: { isbn },
      timeout: 5000,
    });
    if (!Array.isArray(response.data) || !response.data[0]) return null;
    const summary = response.data[0].summary || {};
    if (!summary.title) return null;
    return {
      title: summary.title,
      author: summary.author || null,
      thumbnail: summary.cover || null,
    };
  } catch {
    return null;
  }
};

const enrichWithOpenBD = async (book, authorFallback) => {
  if (!book.isbn) return { ...book, author: authorFallback };
  const openbd = await searchOpenBD(book.isbn);
  return {
    ...book,
    title: openbd?.title || book.title,
    author: openbd?.author || authorFallback,
    thumbnail: openbd?.thumbnail || book.thumbnail,
  };
};

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/scan', upload.single('image'), async (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({ error: '画像をアップロードしてください。' });
  }

  const imagePath = req.file.path;

  try {
    const requestedCount = normalizeRequestedCount(req.body?.requestedCount, 8);
    const candidates = await inferBookCandidatesFromImage(imagePath);
    const candidateSlice = candidates.slice(0, Math.min(Math.max(requestedCount + 4, 12), 20));

    const books = [];
    const BATCH_SIZE = 5;

    for (let i = 0; i < candidateSlice.length; i += BATCH_SIZE) {
      const batch = candidateSlice.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.allSettled(
        batch.map(async (candidate) => {
          // ISBNが判明している場合はOpenBDを直接引く（最高精度）
          if (candidate.isbn) {
            const openbd = await searchOpenBD(candidate.isbn);
            if (openbd) {
              return [{
                title: openbd.title,
                author: openbd.author || candidate.author,
                thumbnail: openbd.thumbnail,
                googleBookId: null,
                isbn: candidate.isbn,
                source: 'llm',
              }];
            }
          }

          // Google Books で検索
          const searchQuery = candidate.author && candidate.author !== '著者情報なし'
            ? `${candidate.title} ${candidate.author}`
            : candidate.title;
          const googleBooks = await searchGoogleBooks(searchQuery, candidate.author);
          const top = googleBooks.slice(0, candidate.confidence === 'high' ? 1 : 2);

          if (top.length === 0 && candidate.confidence === 'high') {
            // 高信頼度でGoogleにない場合はLLMの識別をそのまま使う
            return [{
              title: candidate.title,
              author: candidate.author,
              thumbnail: null,
              googleBookId: null,
              source: 'llm',
            }];
          }

          const enriched = await Promise.allSettled(
            top.map((book) => {
              const authorFallback = book.author && book.author !== '著者情報なし'
                ? book.author : candidate.author;
              return enrichWithOpenBD(book, authorFallback);
            })
          );

          return enriched.filter((r) => r.status === 'fulfilled').map((r) => r.value);
        })
      );
      books.push(...batchResults.filter((r) => r.status === 'fulfilled').flatMap((r) => r.value));
    }

    const uniqueResults = [];
    const seen = new Set();
    for (const book of books) {
      const key = `${book.title}-${book.author}`;
      if (!seen.has(key)) {
        uniqueResults.push({
          ...book,
          id: book.googleBookId || book.isbn || `${book.title}-${book.author}`,
          source: 'llm',
        });
        seen.add(key);
      }
    }

    if (uniqueResults.length === 0) {
      uniqueResults.push(
        ...candidates.slice(0, 16).map((candidate, index) => ({
          id: `candidate-${Date.now()}-${index}`,
          title: candidate.title,
          author: candidate.author || '著者情報なし',
          thumbnail: null,
          googleBookId: null,
          source: 'llm',
        }))
      );
    }

    res.json({ results: uniqueResults.slice(0, requestedCount) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'スキャン処理に失敗しました。' });
  } finally {
    try {
      fs.unlinkSync(imagePath);
    } catch {
      // ignore cleanup errors
    }
  }
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: '画像のアップロードに失敗しました。' });
  }

  if (error) {
    console.error('Upload error', error);
    return res.status(500).json({ error: '画像の処理中にエラーが発生しました。' });
  }

  return res.status(500).json({ error: '予期しないエラーが発生しました。' });
});

const port = Number(process.env.PORT || 3001);
if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`Backend running at http://localhost:${port}`);
  });
}

export { app, inferBookCandidatesFromImage, searchGoogleBooks, searchOpenBD };
