import { useEffect, useMemo, useRef, useState } from 'react';
import {
  activateUserSubscription,
  completeRecount,
  createRecountFromPdf,
  deleteAdminUser,
  finishRecountWithoutPdf,
  getAdminLogs,
  getAdminUsers,
  getRecount,
  getRecounts,
  login,
  logout,
  me,
  reopenRecount,
  register,
  resetUserDeviceBinding,
  resolveBarcode,
  saveRecountProgress,
  setAuthToken,
  updateAccountSettings
} from './api';

const TOKEN_KEY = 'lokalka_auth_token';
const BARCODE_CACHE_STORAGE_KEY = 'barcode_article_cache_v1';
const AUTOSAVE_INTERVAL_MS = 8000;
const ADMIN_LOG_LEVEL_TABS = [
  { key: 'all', label: 'Все' },
  { key: 'error', label: 'Ошибки' },
  { key: 'warn', label: 'Предупр.' },
  { key: 'info', label: 'Инфо' },
  { key: 'debug', label: 'Debug' },
  { key: 'trace', label: 'Trace' }
];

function normalizeQuery(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectPackageType(productName) {
  const normalizedName = normalizeQuery(productName);
  if (normalizedName.includes('ж/б')) return 'can';
  if (normalizedName.includes('ст')) return 'glass';
  return 'pet';
}

function getPackageTypeLabel(packageType) {
  if (packageType === 'can') return 'Железная банка';
  if (packageType === 'glass') return 'Стеклянная бутылка';
  return 'ПЭТ бутылка';
}

function formatSubscriptionStatusLabel(account) {
  if (account?.isAdmin) return 'Администратор';
  if (!account?.subscriptionActive || !account?.subscriptionUntil) return 'Неактивный';
  const until = new Date(account.subscriptionUntil);
  if (Number.isNaN(until.getTime())) return 'Неактивный';
  return `Активный до ${until.toLocaleDateString('ru-RU')}`;
}

function formatRub(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '0.00 руб.';
  return `${amount.toFixed(2)} руб.`;
}

function formatStartDate(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('ru-RU');
}

function formatLogDateTime(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('ru-RU');
}

function formatLogLevel(level) {
  const normalized = String(level || '').toLowerCase();
  if (normalized === 'error') return 'ERROR';
  if (normalized === 'warn') return 'WARN';
  if (normalized === 'debug') return 'DEBUG';
  if (normalized === 'trace') return 'TRACE';
  if (normalized === 'fatal') return 'FATAL';
  return 'INFO';
}

function safeNumber(value) {
  const parsed = Number.parseFloat(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
}

function sanitizeFactExpression(value) {
  let normalized = String(value || '').replace(/[^\d+]/g, '');
  normalized = normalized.replace(/\++/g, '+');
  normalized = normalized.replace(/^\+/, '');
  return normalized;
}

function sumFactExpression(value) {
  const normalized = sanitizeFactExpression(value);
  const parts = normalized.split('+').filter(Boolean);
  if (!parts.length) return null;

  return parts.reduce((acc, part) => acc + safeNumber(part), 0);
}

function supportsBarcodeDetector() {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window;
}

function normalizeBarcodeValue(value) {
  return String(value || '').trim();
}

function loadBarcodeCache() {
  try {
    const raw = localStorage.getItem(BARCODE_CACHE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveBarcodeCache(cache) {
  localStorage.setItem(BARCODE_CACHE_STORAGE_KEY, JSON.stringify(cache || {}));
}

function buildProgressPayload(values, search, barcodeCache) {
  return {
    values,
    search,
    barcodeCache
  };
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [authLogin, setAuthLogin] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');

  const [homeLoading, setHomeLoading] = useState(false);
  const [activeSummary, setActiveSummary] = useState(null);
  const [previousRecounts, setPreviousRecounts] = useState([]);
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminTab, setAdminTab] = useState('users');
  const [adminLogLevel, setAdminLogLevel] = useState('all');
  const [adminLogEntries, setAdminLogEntries] = useState([]);
  const [adminLogCounts, setAdminLogCounts] = useState({});
  const [adminLogLoading, setAdminLogLoading] = useState(false);
  const [activationDays, setActivationDays] = useState('30');
  const [activatingUserId, setActivatingUserId] = useState('');
  const [expandedUserId, setExpandedUserId] = useState('');
  const [deletingUserId, setDeletingUserId] = useState('');

  const [activeRecount, setActiveRecount] = useState(null);
  const [values, setValues] = useState({});
  const [search, setSearch] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [scannerOn, setScannerOn] = useState(false);
  const [scannerStatus, setScannerStatus] = useState('Сканер выключен');
  const [lastCode, setLastCode] = useState('');
  const [torchOn, setTorchOn] = useState(false);
  const [scanSuccessFlash, setScanSuccessFlash] = useState(false);
  const [barcodeCache, setBarcodeCache] = useState(() => loadBarcodeCache());

  const [mismatchModalOpen, setMismatchModalOpen] = useState(false);
  const [completeModalOpen, setCompleteModalOpen] = useState(false);
  const [unresolvedBarcode, setUnresolvedBarcode] = useState('');
  const [candidateCodes, setCandidateCodes] = useState([]);
  const [bindModalOpen, setBindModalOpen] = useState(false);
  const [bindSearch, setBindSearch] = useState('');
  const [counterName, setCounterName] = useState('');
  const [groupName, setGroupName] = useState('');
  const [includeTotalSummary, setIncludeTotalSummary] = useState(true);
  const [updateCompletionTime, setUpdateCompletionTime] = useState(true);
  const [activeFactCode, setActiveFactCode] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [defaultCounterNameInput, setDefaultCounterNameInput] = useState('');
  const [settingsSaving, setSettingsSaving] = useState(false);

  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const scannerStreamRef = useRef(null);
  const scanRafRef = useRef(0);
  const detectorRef = useRef(null);
  const zxingReaderRef = useRef(null);
  const zxingControlsRef = useRef(null);
  const lastCodeRef = useRef('');
  const lastCodeTsRef = useRef(0);
  const pendingBarcodeRequestRef = useRef(new Map());
  const barcodeCacheRef = useRef(barcodeCache);
  const flashTimeoutRef = useRef(0);
  const autosaveSnapshotRef = useRef('');

  useEffect(() => {
    saveBarcodeCache(barcodeCache);
    barcodeCacheRef.current = barcodeCache;
  }, [barcodeCache]);

  useEffect(() => {
    return () => {
      if (flashTimeoutRef.current) {
        clearTimeout(flashTimeoutRef.current);
      }
      stopScanner();
    };
  }, []);

  useEffect(() => {
    if (!token) return;

    setAuthToken(token);
    me()
      .then(res => {
        const nextUser = res.user || null;
        setUser(nextUser);

        if (nextUser?.isAdmin) {
          return Promise.all([refreshAdminUsers(), refreshAdminLogs('all')]);
        }
        if (!nextUser?.subscriptionActive) {
          setActiveRecount(null);
          setActiveSummary(null);
          setPreviousRecounts([]);
          return;
        }
        return refreshDashboard();
      })
      .catch(() => {
        handleLogout(true);
      });
  }, [token]);

  useEffect(() => {
    if (!activeRecount) return;
    const payload = buildProgressPayload(values, search, barcodeCache);
    autosaveSnapshotRef.current = JSON.stringify(payload);
  }, [activeRecount?.id]);

  useEffect(() => {
    if (!activeRecount || !token) return;

    const timer = window.setInterval(async () => {
      const payload = buildProgressPayload(values, search, barcodeCache);
      const snapshot = JSON.stringify(payload);
      if (snapshot === autosaveSnapshotRef.current) return;

      try {
        await saveRecountProgress(activeRecount.id, payload);
        autosaveSnapshotRef.current = snapshot;
      } catch {
        // no-op
      }
    }, AUTOSAVE_INTERVAL_MS);

    return () => {
      clearInterval(timer);
    };
  }, [activeRecount, token, values, search, barcodeCache]);

  const filteredItems = useMemo(() => {
    const query = normalizeQuery(search);
    const items = activeRecount?.items || [];
    if (!query) return items;

    return items.filter(item => {
      const code = normalizeQuery(item.code);
      const name = normalizeQuery(item.name);
      return code.includes(query) || name.includes(query);
    });
  }, [activeRecount, search]);

  const bindFilteredItems = useMemo(() => {
    const query = normalizeQuery(bindSearch);
    const items = activeRecount?.items || [];
    if (!query) return items;

    return items.filter(item => {
      const code = normalizeQuery(item.code);
      const name = normalizeQuery(item.name);
      return code.includes(query) || name.includes(query);
    });
  }, [activeRecount, bindSearch]);

  const candidateItems = useMemo(() => {
    if (!candidateCodes.length) return [];
    const items = activeRecount?.items || [];
    return items.filter(item => candidateCodes.includes(String(item.code)));
  }, [activeRecount, candidateCodes]);

  const mismatchItems = useMemo(() => {
    if (!activeRecount?.items?.length) return [];

    return activeRecount.items
      .map(item => {
        const row = computeRowState(item, values);
        return {
          ...item,
          ...row
        };
      })
      .filter(item => item.delta !== 0);
  }, [activeRecount, values]);

  function computeRowState(item, valueMap) {
    const raw = sanitizeFactExpression(valueMap[item.code] ?? '');
    const manualFact = sumFactExpression(raw);
    const hasManual = raw.length > 0 && manualFact !== null;
    const docQty = safeNumber(item.docQty);
    const fact = hasManual ? manualFact : null;
    const delta = fact === null ? null : fact - docQty;
    const status = delta === null ? '' : delta === 0 ? 'match' : delta < 0 ? 'missing' : 'excess';
    const factDisplay = hasManual ? raw : '';

    return {
      raw,
      docQty,
      fact,
      factDisplay,
      delta,
      status
    };
  }

  function triggerScanSuccessFlash() {
    if (flashTimeoutRef.current) {
      clearTimeout(flashTimeoutRef.current);
    }
    setScanSuccessFlash(true);
    flashTimeoutRef.current = window.setTimeout(() => {
      setScanSuccessFlash(false);
      flashTimeoutRef.current = 0;
    }, 220);
  }

  async function refreshDashboard() {
    setHomeLoading(true);
    setError('');

    try {
      const data = await getRecounts();
      setActiveSummary(data.active || null);
      setPreviousRecounts(Array.isArray(data.previous) ? data.previous : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить данные');
    } finally {
      setHomeLoading(false);
    }
  }

  async function refreshAdminUsers() {
    setHomeLoading(true);
    setError('');
    try {
      const data = await getAdminUsers();
      setAdminUsers(Array.isArray(data.users) ? data.users : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить пользователей');
    } finally {
      setHomeLoading(false);
    }
  }

  async function refreshAdminLogs(level = adminLogLevel) {
    setAdminLogLoading(true);
    setError('');
    try {
      const data = await getAdminLogs(level, 250);
      setAdminLogLevel(data?.selectedLevel || level);
      setAdminLogEntries(Array.isArray(data?.entries) ? data.entries : []);
      setAdminLogCounts(data?.levelCounts && typeof data.levelCounts === 'object' ? data.levelCounts : {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить логи');
    } finally {
      setAdminLogLoading(false);
    }
  }

  async function bootstrapAuth(result) {
    const nextToken = String(result?.token || '').trim();
    if (!nextToken) throw new Error('Сервер не вернул токен');

    localStorage.setItem(TOKEN_KEY, nextToken);
    setAuthToken(nextToken);
    setToken(nextToken);
    const nextUser = result.user || null;
    setUser(nextUser);

    if (nextUser?.isAdmin) {
      await Promise.all([refreshAdminUsers(), refreshAdminLogs('all')]);
      return;
    }

    if (!nextUser?.subscriptionActive) {
      return;
    }

    await refreshDashboard();
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    setAuthLoading(true);
    setAuthError('');

    try {
      const action = authMode === 'register' ? register : login;
      const result = await action(authLogin, authPassword);
      await bootstrapAuth(result);
      setAuthPassword('');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Ошибка авторизации');
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleLogout(skipApi = false) {
    try {
      if (!skipApi && token) {
        await logout();
      }
    } catch {
      // no-op
    }

    stopScanner();
    localStorage.removeItem(TOKEN_KEY);
    setAuthToken('');
    setToken('');
    setUser(null);
    setActiveSummary(null);
    setPreviousRecounts([]);
    setAdminUsers([]);
    setAdminLogLevel('all');
    setAdminLogEntries([]);
    setAdminLogCounts({});
    setActiveRecount(null);
    setValues({});
    setSearch('');
    setMenuOpen(false);
    setMismatchModalOpen(false);
    setCompleteModalOpen(false);
    setSettingsOpen(false);
    setExpandedUserId('');
  }

  function getItemCodes() {
    return Array.isArray(activeRecount?.items) ? activeRecount.items.map(item => String(item.code)) : [];
  }

  async function openRecount(id) {
    setLoading(true);
    setError('');
    try {
      const data = await getRecount(id);
      const recount = data.recount;
      setActiveRecount(recount);
      setValues(recount.values || {});
      setSearch(recount.search || '');
      setUnresolvedBarcode('');
      setCandidateCodes([]);
      setBindModalOpen(false);

      if (recount.barcodeCache && typeof recount.barcodeCache === 'object') {
        setBarcodeCache(prev => ({ ...prev, ...recount.barcodeCache }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось открыть просчет');
    } finally {
      setLoading(false);
    }
  }

  async function reopenPreviousRecount(id) {
    setLoading(true);
    setError('');
    try {
      const data = await reopenRecount(id);
      const recount = data.recount;
      setActiveRecount(recount);
      setValues(recount.values || {});
      setSearch(recount.search || '');
      setMenuOpen(false);
      setMismatchModalOpen(false);
      setCompleteModalOpen(false);
      setUnresolvedBarcode('');
      setCandidateCodes([]);
      setBindModalOpen(false);

      if (recount.barcodeCache && typeof recount.barcodeCache === 'object') {
        setBarcodeCache(prev => ({ ...prev, ...recount.barcodeCache }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось открыть просчет из истории');
    } finally {
      setLoading(false);
    }
  }

  async function handleUpload(event) {
    const selected = event.target.files?.[0];
    if (!selected) return;

    setLoading(true);
    setError('');

    try {
      const parsed = await createRecountFromPdf(selected);
      const recount = parsed.recount;
      setActiveRecount(recount);
      setValues(recount.values || {});
      setSearch(recount.search || '');
      setActiveSummary(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить PDF');
    } finally {
      setLoading(false);
      event.target.value = '';
    }
  }

  async function handleSaveNow() {
    if (!activeRecount) return;

    const payload = buildProgressPayload(values, search, barcodeCache);
    try {
      await saveRecountProgress(activeRecount.id, payload);
      autosaveSnapshotRef.current = JSON.stringify(payload);
      setScannerStatus('Прогресс сохранен');
    } catch {
      setScannerStatus('Ошибка сохранения');
    }

    setMenuOpen(false);
  }

  async function resolveBarcodeWithCache(rawBarcode) {
    const barcode = normalizeBarcodeValue(rawBarcode);
    if (!barcode) {
      return { resolved: false, codes: [], source: 'empty' };
    }

    // The scan loop re-invokes this closure via RAF, so read the ref, not the stale state.
    const localHit = barcodeCacheRef.current[barcode];
    if (localHit?.codes?.length) {
      return {
        resolved: true,
        codes: localHit.codes.map(String),
        source: localHit.source || 'frontend-cache'
      };
    }

    const pending = pendingBarcodeRequestRef.current.get(barcode);
    if (pending) {
      return pending;
    }

    const requestPromise = resolveBarcode(barcode, getItemCodes())
      .then(apiResult => {
        const codes = Array.isArray(apiResult?.codes) ? apiResult.codes.map(String) : [];
        if (apiResult?.resolved && codes.length) {
          setBarcodeCache(prev => {
            const existingCodes = prev[barcode]?.codes || [];
            const merged = Array.from(new Set([...existingCodes, ...codes]));
            return {
              ...prev,
              [barcode]: {
                codes: merged,
                source: apiResult.source || 'backend'
              }
            };
          });
        }
        return { ...apiResult, codes };
      })
      .finally(() => {
        pendingBarcodeRequestRef.current.delete(barcode);
      });

    pendingBarcodeRequestRef.current.set(barcode, requestPromise);
    return requestPromise;
  }

  async function applyScannedCode(code) {
    const now = Date.now();
    if (!code) return;
    if (code === lastCodeRef.current && now - lastCodeTsRef.current < 1500) return;

    lastCodeRef.current = code;
    lastCodeTsRef.current = now;
    setLastCode(code);

    try {
      setScannerStatus('Поиск артикула...');
      const resolved = await resolveBarcodeWithCache(code);
      const codes = resolved?.codes || [];

      if (resolved?.resolved && codes.length === 1) {
        setSearch(codes[0]);
        setScannerStatus(`Штрихкод считан (${resolved.source || 'cache'})`);
        setUnresolvedBarcode('');
        setCandidateCodes([]);
        triggerScanSuccessFlash();
      } else if (resolved?.resolved && codes.length > 1) {
        setScannerStatus('Найдено несколько товаров для этого штрихкода');
        setUnresolvedBarcode(code);
        setCandidateCodes(codes);
      } else {
        setSearch(code);
        setScannerStatus('Артикул не найден, поиск по штрихкоду');
        setUnresolvedBarcode(code);
        setCandidateCodes([]);
      }
    } catch {
      setSearch(code);
      setScannerStatus('Ошибка резолва, поиск по штрихкоду');
      setUnresolvedBarcode(code);
      setCandidateCodes([]);
    }

    if (navigator.vibrate) navigator.vibrate(70);
  }

  function openBindModal() {
    setBindSearch('');
    setBindModalOpen(true);
  }

  function closeBindModal() {
    setBindModalOpen(false);
    setBindSearch('');
  }

  function bindBarcodeToItem(itemCode) {
    const barcode = normalizeBarcodeValue(unresolvedBarcode);
    if (!barcode) return;

    setBarcodeCache(prev => {
      const existingCodes = prev[barcode]?.codes || [];
      const merged = Array.from(new Set([...existingCodes, String(itemCode)]));
      return {
        ...prev,
        [barcode]: {
          codes: merged,
          source: 'manual'
        }
      };
    });

    setSearch(String(itemCode));
    setScannerStatus('Штрихкод привязан вручную');
    setUnresolvedBarcode('');
    setCandidateCodes([]);
    closeBindModal();
    triggerScanSuccessFlash();
    if (navigator.vibrate) navigator.vibrate(70);
  }

  async function scanBarcodeFrame() {
    const video = videoRef.current;
    const detector = detectorRef.current;
    if (!video || !detector || !scannerOn) return;

    try {
      const codes = await detector.detect(video);
      const code = codes[0]?.rawValue;
      if (code) void applyScannedCode(code);
    } catch {
      // no-op
    }

    if (scannerOn) {
      scanRafRef.current = requestAnimationFrame(scanBarcodeFrame);
    }
  }

  async function startScanner() {
    const video = videoRef.current;
    if (!video) return;
    if (!activeRecount?.items?.length) {
      setScannerStatus('Сначала загрузите PDF');
      return;
    }

    try {
      setScannerStatus('Запуск камеры...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });

      scannerStreamRef.current = stream;
      video.srcObject = stream;
      await video.play();

      if (supportsBarcodeDetector()) {
        detectorRef.current = new window.BarcodeDetector({ formats: ['code_128', 'ean_13', 'ean_8'] });
        setScannerOn(true);
        setScannerStatus('Наведите на штрихкод');
        scanRafRef.current = requestAnimationFrame(scanBarcodeFrame);
        return;
      }

      const zxing = await import('@zxing/browser');
      const reader = new zxing.BrowserMultiFormatReader();
      zxingReaderRef.current = reader;
      const controls = await reader.decodeFromVideoDevice(undefined, video, resultObj => {
        if (resultObj) void applyScannedCode(resultObj.getText());
      });
      zxingControlsRef.current = controls;
      setScannerOn(true);
      setScannerStatus('Наведите на штрихкод');
    } catch {
      setScannerStatus('Не удалось запустить сканер');
      stopScanner();
    }
  }

  function stopScanner() {
    setScannerOn(false);
    setTorchOn(false);
    setScannerStatus('Сканер выключен');

    if (scanRafRef.current) {
      cancelAnimationFrame(scanRafRef.current);
      scanRafRef.current = 0;
    }

    zxingControlsRef.current?.stop?.();
    zxingControlsRef.current = null;
    zxingReaderRef.current?.reset?.();
    zxingReaderRef.current = null;
    detectorRef.current = null;

    const stream = scannerStreamRef.current;
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      scannerStreamRef.current = null;
    }

    const video = videoRef.current;
    if (video?.srcObject) {
      video.srcObject = null;
    }
  }

  async function toggleScanner() {
    if (scannerOn) {
      stopScanner();
      return;
    }
    await startScanner();
  }

  async function toggleTorch() {
    const stream = scannerStreamRef.current;
    if (!stream) {
      setScannerStatus('Сначала включите сканер');
      return;
    }

    const track = stream.getVideoTracks()[0];
    if (!track) return;

    try {
      const next = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch {
      setScannerStatus('Фонарик не поддерживается');
    }
  }

  function updateFact(code, nextValue) {
    const normalized = sanitizeFactExpression(nextValue);
    setValues(prev => ({
      ...prev,
      [code]: normalized
    }));
  }

  function handleFactFocus(code) {
    setActiveFactCode(code);
  }

  function handleFactBlur() {
    setActiveFactCode('');
  }

  function appendToActiveFact(char) {
    if (!activeFactCode) return;
    if (navigator.vibrate) navigator.vibrate(18);
    const current = String(values[activeFactCode] ?? '');
    if (char === '+') {
      if (!current || current.endsWith('+')) return;
      updateFact(activeFactCode, `${current}+`);
      return;
    }

    if (/^\d$/.test(char)) {
      updateFact(activeFactCode, `${current}${char}`);
    }
  }

  function eraseActiveFact() {
    if (!activeFactCode) return;
    if (navigator.vibrate) navigator.vibrate(18);
    const current = String(values[activeFactCode] ?? '');
    updateFact(activeFactCode, current.slice(0, -1));
  }

  async function handleCompleteRecount() {
    if (!activeRecount) return;

    setLoading(true);
    setError('');

    try {
      const progressPayload = buildProgressPayload(values, search, barcodeCache);
      const result = await completeRecount(activeRecount.id, {
        ...progressPayload,
        counterName,
        groupName,
        includeTotalSummary,
        updateCompletionTime
      });

      const url = URL.createObjectURL(result.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.fileName;
      link.click();
      URL.revokeObjectURL(url);

      setCompleteModalOpen(false);
      setCounterName('');
      setGroupName('');

      stopScanner();
      setActiveRecount(null);
      await refreshDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось завершить просчет');
    } finally {
      setLoading(false);
    }
  }

  function openCompleteModal() {
    setCounterName(prev => prev || user?.defaultCounterName || '');
    setUpdateCompletionTime(true);
    setCompleteModalOpen(true);
  }

  async function handleFinishWithoutPdf() {
    if (!activeRecount) return;

    setLoading(true);
    setError('');

    try {
      const progressPayload = buildProgressPayload(values, search, barcodeCache);
      await finishRecountWithoutPdf(activeRecount.id, {
        ...progressPayload,
        updateCompletionTime
      });

      setCompleteModalOpen(false);
      setCounterName('');
      setGroupName('');

      stopScanner();
      setActiveRecount(null);
      await refreshDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось завершить просчет');
    } finally {
      setLoading(false);
    }
  }

  async function goHome() {
    stopScanner();
    setActiveRecount(null);
    setMenuOpen(false);
    setMismatchModalOpen(false);
    setCompleteModalOpen(false);
    setUnresolvedBarcode('');
    setCandidateCodes([]);
    setBindModalOpen(false);
    await refreshDashboard();
  }

  async function activateSubscriptionForUser(targetUserId) {
    const parsedDays = Number.parseInt(activationDays, 10);
    const days = Number.isFinite(parsedDays) ? Math.max(1, Math.min(parsedDays, 3650)) : 30;

    setActivatingUserId(targetUserId);
    setError('');
    try {
      await activateUserSubscription(targetUserId, { days });
      await refreshAdminUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось активировать подписку');
    } finally {
      setActivatingUserId('');
    }
  }

  async function resetDeviceBindingForUser(targetUserId) {
    setActivatingUserId(targetUserId);
    setError('');
    try {
      await resetUserDeviceBinding(targetUserId);
      await refreshAdminUsers();
      await refreshAdminLogs(adminLogLevel);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сбросить устройство');
    } finally {
      setActivatingUserId('');
    }
  }

  async function deleteUserAccount(targetUserId) {
    if (!window.confirm('Удалить аккаунт без возможности восстановления?')) return;

    setDeletingUserId(targetUserId);
    setError('');
    try {
      await deleteAdminUser(targetUserId);
      setExpandedUserId('');
      await refreshAdminUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось удалить пользователя');
    } finally {
      setDeletingUserId('');
    }
  }

  function openSettings() {
    setDefaultCounterNameInput(user?.defaultCounterName || '');
    setSettingsOpen(true);
  }

  function closeSettings() {
    setSettingsOpen(false);
  }

  async function saveAccountSettings() {
    setSettingsSaving(true);
    setError('');
    try {
      const result = await updateAccountSettings({ defaultCounterName: defaultCounterNameInput });
      setUser(result.user || null);
      setSettingsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить настройки');
    } finally {
      setSettingsSaving(false);
    }
  }

  if (!token) {
    return (
      <div className="auth-page">
        <form className="auth-card" onSubmit={handleAuthSubmit}>
          <h1>Локалка</h1>
          <p>{authMode === 'login' ? 'Вход в систему' : 'Регистрация пользователя'}</p>

          <input
            value={authLogin}
            onChange={event => setAuthLogin(event.target.value)}
            placeholder="Логин"
            autoComplete="username"
            required
          />
          <input
            value={authPassword}
            onChange={event => setAuthPassword(event.target.value)}
            placeholder="Пароль"
            type="password"
            autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
            required
          />

          {authError ? <div className="status error">{authError}</div> : null}

          <button type="submit" disabled={authLoading}>
            {authLoading ? 'Подождите...' : authMode === 'login' ? 'Войти' : 'Зарегистрироваться'}
          </button>

          <button
            type="button"
            className="ghost"
            onClick={() => {
              setAuthError('');
              setAuthMode(prev => (prev === 'login' ? 'register' : 'login'));
            }}
          >
            {authMode === 'login' ? 'Создать аккаунт' : 'У меня уже есть аккаунт'}
          </button>
        </form>
      </div>
    );
  }

  if (user?.isAdmin) {
    return (
      <div className="home-page">
        <header className="home-header">
          <div>
            <h2>Админ-панель</h2>
            <p>Пользователь: {user?.login || '-'}</p>
          </div>
          <button type="button" onClick={() => handleLogout()} className="ghost">Выйти</button>
        </header>

        {error ? <section className="status error">{error}</section> : null}

        <div className="admin-tabs">
          <button
            type="button"
            className={`admin-tab ${adminTab === 'users' ? 'active' : ''}`}
            onClick={() => setAdminTab('users')}
          >
            Управление аккаунтами
          </button>
          <button
            type="button"
            className={`admin-tab ${adminTab === 'logs' ? 'active' : ''}`}
            onClick={() => setAdminTab('logs')}
          >
            Просмотр логов
          </button>
        </div>

        {adminTab === 'users' ? (
        <section className="panel">
          <h3>Пользователи</h3>
          <div className="admin-actions-row">
            <label className="admin-days-input">
              Дней активации
              <input
                type="number"
                min="1"
                max="3650"
                value={activationDays}
                onChange={event => setActivationDays(event.target.value)}
              />
            </label>
            <button type="button" className="ghost" onClick={refreshAdminUsers} disabled={homeLoading}>
              Обновить список
            </button>
          </div>

          {homeLoading ? <div className="status">Загрузка...</div> : null}

          {!homeLoading ? (
            <div className="admin-users-list">
              {adminUsers.map(item => (
                <article key={item.id} className="admin-user-card">
                  <div className="admin-user-main">
                    <div className="admin-user-login">{item.login}</div>
                    <div className="line mini">Статус: {formatSubscriptionStatusLabel(item)}</div>
                    <div className="line mini">Устройство: {item.deviceBound ? 'Привязано' : 'Не привязано'}</div>
                  </div>
                  <div className="admin-user-actions">
                    <button
                      type="button"
                      onClick={() => activateSubscriptionForUser(item.id)}
                      disabled={item.isAdmin || activatingUserId === item.id}
                    >
                      {activatingUserId === item.id ? 'Подождите...' : 'Активировать'}
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => resetDeviceBindingForUser(item.id)}
                      disabled={activatingUserId === item.id}
                    >
                      Сбросить устройство
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => setExpandedUserId(item.id)}
                    >
                      Настройки
                    </button>
                  </div>
                </article>
              ))}
              {!adminUsers.length ? <div className="status">Пользователи не найдены</div> : null}
            </div>
          ) : null}
        </section>
        ) : null}

        {adminTab === 'logs' ? (
        <section className="panel">
          <h3>Логи сервера</h3>

          <div className="admin-logs-toolbar">
            <div className="admin-log-tabs">
              {ADMIN_LOG_LEVEL_TABS.map(tab => {
                const key = tab.key;
                const count = key === 'all'
                  ? Object.values(adminLogCounts || {}).reduce((acc, value) => acc + Number(value || 0), 0)
                  : Number(adminLogCounts?.[key] || 0);
                const isActive = adminLogLevel === key;

                return (
                  <button
                    key={key}
                    type="button"
                    className={`admin-log-tab ${isActive ? 'active' : ''}`}
                    onClick={() => refreshAdminLogs(key)}
                    disabled={adminLogLoading}
                  >
                    {tab.label} ({count})
                  </button>
                );
              })}
            </div>

            <button type="button" className="ghost" onClick={() => refreshAdminLogs(adminLogLevel)} disabled={adminLogLoading}>
              {adminLogLoading ? 'Загрузка...' : 'Обновить логи'}
            </button>
          </div>

          {adminLogLoading ? <div className="status">Загрузка логов...</div> : null}

          {!adminLogLoading ? (
            <div className="admin-log-list">
              {adminLogEntries.map(entry => (
                <article key={entry.id} className="admin-log-item">
                  <div className="admin-log-item-head">
                    <span className={`admin-log-level ${String(entry.level || 'info').toLowerCase()}`}>
                      {formatLogLevel(entry.level)}
                    </span>
                    <span className="line mini">{formatLogDateTime(entry.ts)}</span>
                  </div>
                  <div className="admin-log-event">{entry.event || '-'}</div>
                  <div className="line mini">
                    Пользователь: {entry.actorLogin || '-'} | IP: {entry.ip || '-'}
                  </div>
                  <details>
                    <summary>Детали</summary>
                    <pre className="admin-log-meta">{JSON.stringify(entry.meta || {}, null, 2)}</pre>
                  </details>
                </article>
              ))}

              {!adminLogEntries.length ? <div className="status">Логи пока отсутствуют</div> : null}
            </div>
          ) : null}
        </section>
        ) : null}

        {expandedUserId ? (() => {
          const targetUser = adminUsers.find(item => item.id === expandedUserId);
          if (!targetUser) return null;

          return (
            <div className="modal-backdrop" onClick={() => setExpandedUserId('')}>
              <div className="modal-card" onClick={event => event.stopPropagation()}>
                <h3>Настройки аккаунта: {targetUser.login}</h3>
                <div className="line mini">Статус: {formatSubscriptionStatusLabel(targetUser)}</div>
                <div className="line mini">Устройство: {targetUser.deviceBound ? 'Привязано' : 'Не привязано'}</div>
                <div className="line mini">Дата регистрации: {formatStartDate(targetUser.createdAt)}</div>

                <button
                  type="button"
                  className="danger"
                  onClick={() => deleteUserAccount(targetUser.id)}
                  disabled={targetUser.isAdmin || deletingUserId === targetUser.id}
                >
                  {deletingUserId === targetUser.id ? 'Удаление...' : 'Удалить аккаунт'}
                </button>
                <button type="button" className="ghost" onClick={() => setExpandedUserId('')}>Закрыть</button>
              </div>
            </div>
          );
        })() : null}
      </div>
    );
  }

  if (user && !user.subscriptionActive) {
    return (
      <div className="auth-page">
        <section className="auth-card">
          <h1>Подписка не активна</h1>
          <p>
            Для доступа к сервису нужна активная подписка.
            {' '}
            Обратитесь в{' '}
            <a href="https://t.me/alekseikb58" target="_blank" rel="noreferrer">
              Telegram t.me/alekseikb58
            </a>{' '}
            для активации аккаунта.
          </p>
          <div className="status">Статус: {formatSubscriptionStatusLabel(user)}</div>
          <button type="button" className="ghost" onClick={() => handleLogout()}>
            Выйти
          </button>
        </section>
      </div>
    );
  }

  if (!activeRecount) {
    return (
      <div className="home-page">
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          onChange={handleUpload}
          className="hidden-file"
        />

        <header className="home-header">
          <div>
            <h2>Локалка</h2>
            <p>Пользователь: {user?.login || '-'}</p>
          </div>
          <div className="home-header-actions">
            <button type="button" className="ghost" onClick={openSettings}>Настройки</button>
            <button type="button" onClick={() => handleLogout()} className="ghost">Выйти</button>
          </div>
        </header>

        {error ? <section className="status error">{error}</section> : null}

        <section className="panel">
          <h3>Активный просчет</h3>
          {homeLoading ? <div className="status">Загрузка...</div> : null}

          {!homeLoading && activeSummary ? (
            <div className="compact-card">
              <div>Документ: {activeSummary.docId}</div>
              <div>Позиции: {activeSummary.totalItems}</div>
              <div>Расхождения: {activeSummary.mismatchCount}</div>
              <button type="button" onClick={() => openRecount(activeSummary.id)}>Продолжить</button>
            </div>
          ) : null}

          {!homeLoading && !activeSummary ? (
            <div className="compact-card">
              <div>Для начала нового просчета загрузите PDF-файл</div>
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={loading}>
                {loading ? 'Загрузка...' : 'Загрузить .PDF'}
              </button>
            </div>
          ) : null}
        </section>

        <section className="panel">
          <h3>Завершенные локалки</h3>
          {!previousRecounts.length ? <div className="status">История пустая</div> : null}
          <div className="history-list">
            {previousRecounts.map(item => (
              <article key={item.id} className="history-item">
                <div className="history-item-head">
                  <div>{item.groupName || 'Без названия группы'}</div>
                  <button
                    type="button"
                    className="history-eye-btn"
                    title="Открыть для доработки"
                    aria-label="Открыть для доработки"
                    onClick={() => reopenPreviousRecount(item.id)}
                    disabled={loading}
                  >
                    👁
                  </button>
                </div>
                <div className="line mini">Итог: {formatRub(item.totalSumRub)}</div>
                <div className="line mini">Дата начала: {formatStartDate(item.createdAt)}</div>
                <div className="line mini">Просчитывающий: {item.counterName || '-'}</div>
              </article>
            ))}
          </div>
        </section>

        {settingsOpen ? (
          <div className="modal-backdrop" onClick={closeSettings}>
            <div className="modal-card" onClick={event => event.stopPropagation()}>
              <h3>Настройки</h3>
              <div className="line mini">Подписка: {formatSubscriptionStatusLabel(user)}</div>
              <label className="settings-field">
                Просчитывающий по умолчанию
                <input
                  value={defaultCounterNameInput}
                  onChange={event => setDefaultCounterNameInput(event.target.value)}
                  placeholder="Имя, которое будет подставляться автоматически"
                />
              </label>
              <button type="button" onClick={saveAccountSettings} disabled={settingsSaving}>
                {settingsSaving ? 'Сохранение...' : 'Сохранить'}
              </button>
              <button type="button" className="ghost" onClick={closeSettings}>Закрыть</button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="recount-page">
      <div className="recount-top">
        <header className={`scanner-shell ${scanSuccessFlash ? 'scan-success-flash' : ''}`}>
          <div className={`scanner-viewport ${scannerOn ? 'active' : ''}`}>
            <video ref={videoRef} autoPlay muted playsInline />
            <div className="scanner-guide" />
          </div>
          <div className="scanner-meta">
            <span>{loading ? 'Подождите...' : scannerStatus}</span>
            <span className="scanner-last">{lastCode || `Документ: ${activeRecount.docId}`}</span>
          </div>
          {unresolvedBarcode ? (
            <div className="scanner-unresolved">
              <span>
                {candidateCodes.length > 1
                  ? `Штрихкод ${unresolvedBarcode}: несколько вариантов товара`
                  : `Штрихкод ${unresolvedBarcode} не найден`}
              </span>
              <button type="button" onClick={openBindModal}>
                {candidateCodes.length > 1 ? 'Выбрать товар' : 'Привязать вручную'}
              </button>
            </div>
          ) : null}
        </header>

        <section className="search-block">
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Поиск по артикулу или названию"
          />
          {search ? (
            <button
              type="button"
              className="search-clear-btn"
              aria-label="Очистить поиск"
              onClick={() => setSearch('')}
            >
              ✕
            </button>
          ) : null}
        </section>

        {error ? <section className="status error">{error}</section> : null}
      </div>

      <main className={`items-feed ${activeFactCode ? 'keypad-open' : ''}`}>
        {filteredItems.map(item => {
          const row = computeRowState(item, values);
          const packageType = detectPackageType(item.name);

          return (
            <article key={item.code} className={`item-card ${row.status}`}>
              <div className="line"><strong>Артикул:</strong> {item.code}</div>
              <div className="line"><strong>Название:</strong> {item.name}</div>
              <div className="line mini">
                <strong>Ед:</strong>{' '}
                <span
                  className={`pack-icon ${packageType}`}
                  title={getPackageTypeLabel(packageType)}
                  aria-label={getPackageTypeLabel(packageType)}
                />
                <span>{item.unit || '—'}</span>
                {' '}| <strong>Цена:</strong> {item.price ?? '—'}
              </div>
              <div className="line mini"><strong>По документам:</strong> {item.docQty ?? '—'} | <strong>Разница:</strong> {row.delta === null ? '—' : row.delta}</div>
              <input
                className={`fact-input ${activeFactCode === item.code ? 'active' : ''}`}
                value={row.raw}
                onChange={event => updateFact(item.code, event.target.value)}
                onFocus={() => handleFactFocus(item.code)}
                onClick={() => handleFactFocus(item.code)}
                onBlur={handleFactBlur}
                readOnly
                type="text"
                inputMode="none"
                pattern="[0-9+]*"
                placeholder="Фактическое количество"
              />
            </article>
          );
        })}
      </main>

      <div className={`menu-popup ${menuOpen ? 'open' : ''}`}>
        <button type="button" onClick={handleSaveNow}>Сохранить сейчас</button>
        <button type="button" onClick={() => {
          setMismatchModalOpen(true);
          setMenuOpen(false);
        }}>
          Расхождения ({mismatchItems.length})
        </button>
        <button type="button" onClick={() => {
          openCompleteModal();
          setMenuOpen(false);
        }}>
          Завершить
        </button>
        <button type="button" onClick={goHome}>На главный</button>
      </div>

      <nav className="bottom-actions">
        <button type="button" className={scannerOn ? 'active' : ''} onClick={toggleScanner}>Сканер</button>
        <button type="button" className={torchOn ? 'active' : ''} onClick={toggleTorch}>Фонарик</button>
        <button type="button" className={menuOpen ? 'active' : ''} onClick={() => setMenuOpen(prev => !prev)}>Меню</button>
      </nav>

      {activeFactCode ? (
        <div className="fact-keypad">
          <div className="fact-keypad-grid">
            <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => appendToActiveFact('1')}>1</button>
            <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => appendToActiveFact('2')}>2</button>
            <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => appendToActiveFact('3')}>3</button>
            <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => appendToActiveFact('4')}>4</button>
            <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => appendToActiveFact('5')}>5</button>
            <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => appendToActiveFact('6')}>6</button>
            <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => appendToActiveFact('7')}>7</button>
            <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => appendToActiveFact('8')}>8</button>
            <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => appendToActiveFact('9')}>9</button>
            <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => appendToActiveFact('+')}>+</button>
            <button type="button" onMouseDown={event => event.preventDefault()} onClick={() => appendToActiveFact('0')}>0</button>
            <button type="button" onMouseDown={event => event.preventDefault()} onClick={eraseActiveFact}>⌫</button>
          </div>
        </div>
      ) : null}

      {mismatchModalOpen ? (
        <div className="modal-backdrop" onClick={() => setMismatchModalOpen(false)}>
          <div className="modal-card" onClick={event => event.stopPropagation()}>
            <h3>Позиции с расхождениями</h3>
            {!mismatchItems.length ? <div className="status">Расхождений нет</div> : null}
            {mismatchItems.length ? (
              <div className="compact-table-wrap">
                <table className="compact-table">
                  <colgroup>
                    <col className="col-name" />
                    <col className="col-num" />
                    <col className="col-num" />
                    <col className="col-num" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Название</th>
                      <th>Остаток</th>
                      <th>Факт</th>
                      <th>Разница</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mismatchItems.map(item => {
                      const factClass = item.delta === null ? 'num-neutral' : item.delta < 0 ? 'num-negative' : 'num-positive';
                      const deltaClass = item.delta === null ? 'num-neutral' : item.delta < 0 ? 'num-negative' : 'num-positive';
                      const deltaText = item.delta === null ? '-' : `${item.delta > 0 ? '+' : ''}${item.delta}`;
                      const factText = item.fact === null ? '-' : String(item.fact);

                      return (
                        <tr key={item.code}>
                          <td className="cell-name">{item.name}</td>
                          <td>{item.docQty ?? '-'}</td>
                          <td className={factClass}>{factText}</td>
                          <td className={deltaClass}>{deltaText}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
            <button type="button" onClick={() => setMismatchModalOpen(false)}>Закрыть</button>
          </div>
        </div>
      ) : null}

      {completeModalOpen ? (
        <div className="modal-backdrop" onClick={() => setCompleteModalOpen(false)}>
          <div className="modal-card" onClick={event => event.stopPropagation()}>
            <h3>Завершение просчета</h3>
            <input
              value={counterName}
              onChange={event => setCounterName(event.target.value)}
              placeholder="Просчитывающий"
            />
            <input
              value={groupName}
              onChange={event => setGroupName(event.target.value)}
              placeholder="Товарная группа"
            />
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={includeTotalSummary}
                onChange={event => setIncludeTotalSummary(event.target.checked)}
              />
              Свести -/+
            </label>
            {activeRecount?.completedAt ? (
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={updateCompletionTime}
                  onChange={event => setUpdateCompletionTime(event.target.checked)}
                />
                Обновить время просчета
              </label>
            ) : null}
            <button type="button" onClick={handleCompleteRecount} disabled={loading}>Скачать итоговый PDF и завершить</button>
            <button type="button" className="ghost" onClick={handleFinishWithoutPdf} disabled={loading}>Выйти в меню</button>
            <button type="button" className="ghost" onClick={() => setCompleteModalOpen(false)}>Отмена</button>
          </div>
        </div>
      ) : null}

      {bindModalOpen ? (
        <div className="modal-backdrop" onClick={closeBindModal}>
          <div className="modal-card" onClick={event => event.stopPropagation()}>
            <h3>Привязать штрихкод {unresolvedBarcode}</h3>
            {candidateItems.length ? (
              <>
                <div className="line mini">Ранее встречались варианты:</div>
                <div className="bind-item-list">
                  {candidateItems.map(item => (
                    <button
                      key={`candidate-${item.code}`}
                      type="button"
                      className="bind-item-row"
                      onClick={() => bindBarcodeToItem(item.code)}
                    >
                      <span className="bind-item-code">{item.code}</span>
                      <span className="bind-item-name">{item.name}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : null}
            <input
              value={bindSearch}
              onChange={event => setBindSearch(event.target.value)}
              placeholder="Найдите товар по артикулу или названию"
              autoFocus
            />
            <div className="bind-item-list">
              {!bindFilteredItems.length ? <div className="status">Товары не найдены</div> : null}
              {bindFilteredItems.map(item => (
                <button
                  key={item.code}
                  type="button"
                  className="bind-item-row"
                  onClick={() => bindBarcodeToItem(item.code)}
                >
                  <span className="bind-item-code">{item.code}</span>
                  <span className="bind-item-name">{item.name}</span>
                </button>
              ))}
            </div>
            <button type="button" className="ghost" onClick={closeBindModal}>Отмена</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
