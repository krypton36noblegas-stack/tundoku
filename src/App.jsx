import { useEffect, useMemo, useState } from 'react';
import bookshelfImg from './assets/bookshelf.png';
import bookImg from './assets/book.png';
import { normalizeRequestedCount } from '../scanConfig.js';

const STORAGE_KEY = 'tundoku-library';

function App() {
  const [image, setImage] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [scannedBooks, setScannedBooks] = useState([]);
  const [library, setLibrary] = useState([]);
  const [error, setError] = useState('');
  const [requestedCount, setRequestedCount] = useState('10');
  const [page, setPage] = useState('scan');

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        setLibrary(JSON.parse(saved));
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(library));
  }, [library]);

  const summary = useMemo(() => {
    const counts = library.reduce((acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    }, {});
    return { total: library.length, count: counts };
  }, [library]);

  const getResultId = (result) => result.id || result.googleBookId || `${result.title}-${result.author}`;

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImage(file);
    setScannedBooks([]);
    setError('');
    setPreviewUrl(URL.createObjectURL(file));
  };

  const handleScan = async () => {
    if (!image) return;
    setScannedBooks([]);
    setError('');
    setIsScanning(true);

    const formData = new FormData();
    formData.append('image', image);
    formData.append('requestedCount', String(normalizeRequestedCount(requestedCount)));

    try {
      const response = await fetch('/api/scan', { method: 'POST', body: formData });
      const text = await response.text();
      let data = {};
      if (text) {
        try { data = JSON.parse(text); }
        catch { data = { error: 'サーバーから無効な応答を受け取りました。' }; }
      }
      if (!response.ok) throw new Error(data.error || `スキャンに失敗しました (${response.status})`);

      const libraryTitles = new Set(library.map((item) => item.title));
      const newBooks = (data.results || [])
        .filter((result) => !libraryTitles.has(result.title))
        .map((result, index) => ({
          id: getResultId(result) || `${result.title || 'book'}-${index}`,
          title: result.title,
          author: result.author,
          thumbnail: result.thumbnail,
          status: '積読',
          source: result.source,
          createdAt: new Date().toISOString(),
        }));

      setScannedBooks(newBooks);
      setLibrary((current) => [...newBooks, ...current]);
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : 'スキャンに失敗しました');
    } finally {
      setIsScanning(false);
    }
  };

  const toggleReading = (id) => {
    setLibrary((current) =>
      current.map((item) =>
        item.id === id
          ? { ...item, status: item.status === '読書中' ? '積読' : '読書中' }
          : item
      )
    );
  };

  const markAsRead = (id) => {
    setLibrary((current) =>
      current.map((item) => (item.id === id ? { ...item, status: '読了' } : item))
    );
  };

  const moveToTundoku = (id) => {
    setLibrary((current) =>
      current.map((item) => (item.id === id ? { ...item, status: '積読' } : item))
    );
  };

  const removeBook = (id, title) => {
    if (!window.confirm(`「${title}」を削除しますか？`)) return;
    setLibrary((current) => current.filter((item) => item.id !== id));
  };

  const tundokuBooks = library
    .filter((b) => b.status === '積読' || b.status === '読書中')
    .sort((a, b) => {
      if (a.status === '読書中' && b.status !== '読書中') return -1;
      if (a.status !== '読書中' && b.status === '読書中') return 1;
      return 0;
    });

  const readBooks = library.filter((b) => b.status === '読了');

  return (
    <div className="app-shell">
      <header className="hero-card">
        <div className="hero-top">
          <h1>つ ん ど く</h1>
          <img className="hero-bookshelf" src={bookshelfImg} alt="本棚のイラスト" />
        </div>
        <div className="hero-stats">
          <div className="hero-stat-card">
            <div className="hero-stat-content">
              <strong>{summary.total}</strong>
              <span>登録済み</span>
            </div>
            <img className="hero-stat-image" src={bookImg} alt="" />
          </div>
          <div className="hero-stat-card">
            <div className="hero-stat-content">
              <strong>{(summary.count?.['積読'] || 0) + (summary.count?.['読書中'] || 0)}</strong>
              <span>つんどく</span>
            </div>
            <img className="hero-stat-image" src={bookImg} alt="" />
          </div>
          <div className="hero-stat-card">
            <div className="hero-stat-content">
              <strong>{summary.count?.['読了'] || 0}</strong>
              <span>よんだほん</span>
            </div>
            <img className="hero-stat-image" src={bookImg} alt="" />
          </div>
        </div>
      </header>

      <nav className="tab-nav">
        <button className={page === 'scan' ? 'tab-btn active' : 'tab-btn'} onClick={() => setPage('scan')}>
          よみとる
        </button>
        <button className={page === 'tundoku' ? 'tab-btn active' : 'tab-btn'} onClick={() => setPage('tundoku')}>
          つんどく
        </button>
        <button className={page === 'read' ? 'tab-btn active' : 'tab-btn'} onClick={() => setPage('read')}>
          よんだほん
        </button>
      </nav>

      <main>
        {page === 'scan' && (
          <section className="panel">
            <div className="scan-options">
              <label>読み取れそうな冊数</label>
              <div className="count-btns">
                {['5', '10', '15', '20'].map((n) => (
                  <button
                    key={n}
                    className={`count-btn${requestedCount === n ? ' active' : ''}`}
                    onClick={() => setRequestedCount(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <label className="upload-box">
              <input type="file" accept="image/*" onChange={handleFileChange} />
              <span>{image ? '別の写真に切り替える' : '写真を選択する'}</span>
            </label>

            {previewUrl ? <img className="preview" src={previewUrl} alt="アップロードした本棚" /> : null}
            {image && !isScanning ? (
              <button className="scan-btn" onClick={handleScan}>よみとる</button>
            ) : null}
            {isScanning ? <p className="status">かいせきちゅう…</p> : null}
            {error ? <p className="error">{error}</p> : null}

            {scannedBooks.length > 0 && (
              <div>
                <p className="scanned-label">{scannedBooks.length}冊をつんどくに追加しました</p>
                <div className="results-list">
                  {scannedBooks.map((book) => (
                    <article className="result-card" key={book.id}>
                      <div className="result-main">
                        {book.thumbnail ? (
                          <img src={book.thumbnail} alt={book.title} />
                        ) : (
                          <div className="thumb-placeholder">No image</div>
                        )}
                        <div>
                          <h3>{book.title}</h3>
                          <p>{book.author || '著者情報なし'}</p>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {page === 'tundoku' && (
          <section className="panel">
            {tundokuBooks.length === 0 ? (
              <p className="empty">つんどくはありません。写真から本を追加してください。</p>
            ) : null}
            <div className="library-list">
              {tundokuBooks.map((book) => (
                <article
                  className={`library-card${book.status === '読書中' ? ' reading' : ''}`}
                  key={book.id}
                >
                  <div className="library-info">
                    <h3>{book.title}</h3>
                    <p>{book.author || '著者情報なし'}</p>
                  </div>
                  <div className="library-actions">
                    <button className="read-btn" onClick={() => markAsRead(book.id)}>よんだ</button>
                    <button className="ghost" onClick={() => removeBook(book.id, book.title)}>削除</button>
                    <button
                      className={`star-btn${book.status === '読書中' ? ' active' : ''}`}
                      onClick={() => toggleReading(book.id)}
                      title="いま読んでる"
                    >
                      ★
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {page === 'read' && (
          <section className="panel">
            {readBooks.length === 0 ? (
              <p className="empty">まだよんだほんはありません。</p>
            ) : null}
            <div className="library-list">
              {readBooks.map((book) => (
                <article className="library-card read" key={book.id}>
                  <div className="library-info">
                    <h3>{book.title}</h3>
                    <p>{book.author || '著者情報なし'}</p>
                  </div>
                  <div className="library-actions">
                    <button className="back-btn" onClick={() => moveToTundoku(book.id)}>もどす</button>
                    <button className="ghost" onClick={() => removeBook(book.id, book.title)}>削除</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
