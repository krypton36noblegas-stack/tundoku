import { useEffect, useMemo, useState } from 'react';
import bookshelfImg from './assets/bookshelf.png';
import bookImg from './assets/book.png';
import { normalizeRequestedCount } from '../scanConfig.js';

const STORAGE_KEY = 'tundoku-library';

function App() {
  const [image, setImage] = useState(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [results, setResults] = useState([]);
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

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImage(file);
    setResults([]);
    setError('');
    setPreviewUrl(URL.createObjectURL(file));
    setIsScanning(true);

    const formData = new FormData();
    formData.append('image', file);
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
      setResults((data.results || []).map((result, index) => ({
        ...result,
        id: getResultId(result) || `${result.title || 'book'}-${index}`,
      })));
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : 'スキャンに失敗しました');
    } finally {
      setIsScanning(false);
    }
  };

  const addToLibrary = (result) => {
    const entry = {
      id: `${result.googleBookId || result.title}-${Date.now()}`,
      title: result.title,
      author: result.author,
      thumbnail: result.thumbnail,
      status: '積読',
      source: result.source,
      createdAt: new Date().toISOString(),
    };
    setLibrary((current) => {
      const alreadyExists = current.some((item) => item.title === entry.title && item.author === entry.author);
      return alreadyExists ? current : [entry, ...current];
    });
    setResults((current) => current.filter((item) => getResultId(item) !== getResultId(result)));
  };

  const skipResult = (result) => {
    setResults((current) => current.filter((item) => getResultId(item) !== getResultId(result)));
  };

  const changeStatus = (id, status) => {
    setLibrary((current) => current.map((item) => (item.id === id ? { ...item, status } : item)));
  };

  const removeBook = (id, title) => {
    if (!window.confirm(`「${title}」を削除しますか？`)) return;
    setLibrary((current) => current.filter((item) => item.id !== id));
  };

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
              <strong>{summary.count?.['積読'] || 0}</strong>
              <span>積読中</span>
            </div>
            <img className="hero-stat-image" src={bookImg} alt="" />
          </div>
          <div className="hero-stat-card">
            <div className="hero-stat-content">
              <strong>{summary.count?.['読了'] || 0}</strong>
              <span>読了</span>
            </div>
            <img className="hero-stat-image" src={bookImg} alt="" />
          </div>
        </div>
      </header>

      <nav className="tab-nav">
        <button className={page === 'scan' ? 'tab-btn active' : 'tab-btn'} onClick={() => setPage('scan')}>
          スキャン
        </button>
        <button className={page === 'library' ? 'tab-btn active' : 'tab-btn'} onClick={() => setPage('library')}>
          ライブラリ
        </button>
      </nav>

      <main>
        {page === 'scan' && (
          <section className="panel">
            <div className="scan-options">
              <label htmlFor="requested-count">おおよその冊数</label>
              <input
                id="requested-count"
                className="count-input"
                type="number"
                min="1"
                max="20"
                value={requestedCount}
                onChange={(event) => setRequestedCount(event.target.value)}
                placeholder="10"
              />
              <small>この数に近い候補を表示します（1〜20）</small>
            </div>

            <label className="upload-box">
              <input type="file" accept="image/*" capture="environment" onChange={handleFileChange} />
              <span>{image ? '別の写真に切り替える' : '写真を選択してスキャン'}</span>
            </label>

            {previewUrl ? <img className="preview" src={previewUrl} alt="アップロードした本棚" /> : null}
            {isScanning ? <p className="status">かいせきちゅう…</p> : null}
            {error ? <p className="error">{error}</p> : null}

            <div className="results-list">
              {results.map((result) => (
                <article className="result-card" key={getResultId(result)}>
                  <div className="result-main">
                    {result.thumbnail ? <img src={result.thumbnail} alt={result.title} /> : <div className="thumb-placeholder">No image</div>}
                    <div>
                      <h3>{result.title}</h3>
                      <p>{result.author || '著者情報なし'}</p>
                      <small>AI が認識</small>
                    </div>
                  </div>
                  <div className="result-actions">
                    <button onClick={() => addToLibrary(result)}>ついか</button>
                    <button className="secondary" onClick={() => skipResult(result)}>ここにはない</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {page === 'library' && (
          <section className="panel">
            {library.length === 0 ? <p className="empty">まだ登録されていません。写真から本を追加してください。</p> : null}
            <div className="library-list">
              {library.map((book) => (
                <article className="library-card" key={book.id}>
                  <div className="library-main">
                    {book.thumbnail ? <img src={book.thumbnail} alt={book.title} /> : <div className="thumb-placeholder">Book</div>}
                    <div>
                      <h3>{book.title}</h3>
                      <p>{book.author || '著者情報なし'}</p>
                    </div>
                  </div>
                  <div className="library-actions">
                    <select value={book.status} onChange={(event) => changeStatus(book.id, event.target.value)}>
                      <option value="積読">つんどく</option>
                      <option value="読書中">よんでる</option>
                      <option value="読了">よんだやつ</option>
                    </select>
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
