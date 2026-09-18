import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import bwipjs from 'bwip-js';
import {
  normalizeScannedCode,
  sanitizeFactExpression,
  sumFactExpression
} from '../../shared/recount-utils.js';
import { markCompletionSurveyPending, track } from './analytics';
import {
  activateReferralCode,
  activateUserSubscription,
  bindBarcodeToItem,
  completeRecount,
  createAdminPatchNote,
  createRecountFromPdf,
  createRecountFromQr,
  deleteAdminPatchNote,
  deleteAdminUser,
  deleteRecount,
  finishRecountWithoutPdf,
  getAdminCodebook,
  getAdminContactLinks,
  getAdminLogs,
  getAdminPatchNotes,
  getAdminProductByCode,
  getAdminShopApiSettings,
  getAdminUsers,
  getMyReferralStats,
  getSecurityCodebook,
  getSecurityProductByCode,
  updateAdminCodebookEntry,
  deleteAdminCodebookEntry,
  updateSecurityCodebookEntry,
  deleteSecurityCodebookEntry,
  getPatchNotes,
  getRecount,
  getRecounts,
  login,
  logout,
  me,
  register,
  reopenRecount,
  resetUserDeviceBinding,
  resolveBarcode,
  saveRecountProgress,
  setAuthToken,
  setUserSecurityRole,
  setUserDeviceBindingDisabled,
  issueUserReferralCode as issueUserReferralCodeApi,
  updateAccountSettings,
  updateAdminContactLinks,
  updateAdminPatchNote,
  updateAdminShopApiToken
} from './api';

import {
  FEEDBACK_SOUND_STORAGE_KEY,
  triggerHaptic
} from './utils/audio.js';
import {
  loadBarcodeCache,
  normalizeBarcodeValue,
  reassignBarcodeToItem,
  saveBarcodeCache
} from './utils/barcode.js';
import {
  formatStartDate,
  getUserDaysRemaining,
  safeNumber
} from './utils/formatting.js';
import {
  normalizePatchNote,
  sortPatchNotes
} from './utils/patchnotes.js';
import { matchesSearchQuery } from './utils/search.js';
import {
  formatTsdDate,
  normalizeTsdPrice,
  parseTsdQr
} from './utils/tsd.js';

import { useBarcodeScanner } from './hooks/useBarcodeScanner.js';

import AuthPage from './components/auth/AuthPage.jsx';
import SubscriptionExpiredPage from './components/auth/SubscriptionExpiredPage.jsx';
import AdminPage from './components/admin/AdminPage.jsx';
import TsdPage from './components/tsd/TsdPage.jsx';
import HomePage from './components/home/HomePage.jsx';
import RecountPage from './components/recount/RecountPage.jsx';
import KeypadSandboxPage from './KeypadSandboxPage.jsx';
import CodebookPage from './components/codebook/CodebookPage.jsx';
import QrTestPage from './components/QrTestPage.jsx';
import { Decoder } from '../../shared/txqr.js';

const TOKEN_KEY = 'lokalka_auth_token';
const PENDING_INVITE_KEY = 'lokalka_pending_invite';
const AUTOSAVE_INTERVAL_MS = 8000;

function normalizeInviteCode(rawValue) {
  return String(rawValue || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 20);
}

function getInviteFromUrl() {
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams(window.location.search);
  return normalizeInviteCode(params.get('invite'));
}

function buildInviteLink(inviteCode) {
  if (typeof window === 'undefined') return '';
  const code = normalizeInviteCode(inviteCode);
  if (!code) return '';
  const url = new URL(window.location.origin);
  url.pathname = '/';
  url.searchParams.set('invite', code);
  return url.toString();
}

async function copyTextWithFallback(rawText) {
  const text = String(rawText || '');
  if (!text) {
    return { ok: false, error: 'Пустую ссылку скопировать нельзя.' };
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return { ok: true };
    } catch {
      // Fallback below for denied permissions or insecure context.
    }
  }

  if (typeof document === 'undefined') {
    return { ok: false, error: 'Буфер обмена недоступен в этом окружении.' };
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    const copied = document.execCommand('copy');
    if (!copied) {
      return { ok: false, error: 'Не удалось скопировать ссылку. Скопируйте ее вручную.' };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Не удалось скопировать ссылку. Скопируйте ее вручную.' };
  } finally {
    textarea.remove();
  }
}

function isSecurityUserRole(account) {
  return Boolean(account?.securityRole || account?.role === 'security' || account?.role === 'sb' || account?.isSecurity || account?.isSb);
}

function hasUsedReferralCode(account) {
  return Boolean(account?.referralUsedAt || account?.usedReferralCode || account?.hasUsedReferral || account?.referralActivationId);
}

function buildProgressPayload(values, search, barcodeCache) {
  return {
    values,
    search,
    barcodeCache
  };
}

function valueMapForProgress(items, valueMap) {
  const source = items && Array.isArray(items) ? items : [];
  const result = {};
  for (const item of source) {
    result[item.code] = valueMap?.[item.code] ?? '';
  }
  return result;
}

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

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const [user, setUser] = useState(null);
  const [authMode, setAuthMode] = useState('login');
  const [authLogin, setAuthLogin] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authInviteBanner, setAuthInviteBanner] = useState(null);

  const [homeLoading, setHomeLoading] = useState(false);
  const [homeTab, setHomeTab] = useState('recounts');
  const [homeInviteNotice, setHomeInviteNotice] = useState('');
  const [activeSummary, setActiveSummary] = useState(null);
  const [previousRecounts, setPreviousRecounts] = useState([]);
  const [patchNotes, setPatchNotes] = useState([]);
  const [patchNotesLoading, setPatchNotesLoading] = useState(false);
  const [patchNotesError, setPatchNotesError] = useState('');
  const [expandedPatchNotes, setExpandedPatchNotes] = useState({});

  const [adminUsers, setAdminUsers] = useState([]);
  const [adminTab, setAdminTab] = useState('users');
  const [adminUserSearch, setAdminUserSearch] = useState('');
  const [adminUserFilter, setAdminUserFilter] = useState('all');
  const [adminLogLevel, setAdminLogLevel] = useState('all');
  const [adminLogGroup, setAdminLogGroup] = useState('all');
  const [adminLogSelectedUsers, setAdminLogSelectedUsers] = useState([]);
  const [adminLogUsers, setAdminLogUsers] = useState([]);
  const [adminLogSearch, setAdminLogSearch] = useState('');
  const [adminLogVisibleLimit, setAdminLogVisibleLimit] = useState(50);
  const [adminLogEntries, setAdminLogEntries] = useState([]);
  const [adminLogCounts, setAdminLogCounts] = useState({});
  const [adminLogGroupCounts, setAdminLogGroupCounts] = useState({});
  const [adminLogLoading, setAdminLogLoading] = useState(false);
  const [adminContactLinks, setAdminContactLinks] = useState({ telegramUrl: '', maxUrl: '' });
  const [adminContactLinksSaving, setAdminContactLinksSaving] = useState(false);
  const [shopApiTokenInput, setShopApiTokenInput] = useState('');
  const [shopApiTokenStatus, setShopApiTokenStatus] = useState(null);
  const [shopApiTokenSaving, setShopApiTokenSaving] = useState(false);
  const [activationDays, setActivationDays] = useState('30');
  const [activatingUserId, setActivatingUserId] = useState('');
  const [expandedUserId, setExpandedUserId] = useState('');
  const [deletingUserId, setDeletingUserId] = useState('');
  const [deletingRecountId, setDeletingRecountId] = useState('');
  const [adminPatchNotes, setAdminPatchNotes] = useState([]);
  const [adminPatchNotesLoading, setAdminPatchNotesLoading] = useState(false);
  const [adminPatchNotesSavingId, setAdminPatchNotesSavingId] = useState('');
  const [adminPatchNotesDeletingId, setAdminPatchNotesDeletingId] = useState('');
  const [newPatchNoteDate, setNewPatchNoteDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newPatchNoteTitle, setNewPatchNoteTitle] = useState('');
  const [newPatchNoteText, setNewPatchNoteText] = useState('');
  const [adminNewPatchNoteOpen, setAdminNewPatchNoteOpen] = useState(false);
  const [adminSuccess, setAdminSuccess] = useState('');
  const [copiedLogId, setCopiedLogId] = useState('');
  const [referralTrialDays, setReferralTrialDays] = useState(1);
  const [codebookData, setCodebookData] = useState({ entries: [], total: 0, page: 1, limit: 12, totalPages: 1, stats: {} });
  const [codebookFilter, setCodebookFilter] = useState('all');
  const [codebookPage, setCodebookPage] = useState(1);
  const [codebookLoading, setCodebookLoading] = useState(false);
  const [codebookLoadingMore, setCodebookLoadingMore] = useState(false);
  const [codebookSearch, setCodebookSearch] = useState('');
  const [codebookProducts, setCodebookProducts] = useState({});
  const [productCard, setProductCard] = useState(null);
  const [productCardLoading, setProductCardLoading] = useState(false);
  const [productCardError, setProductCardError] = useState('');
  const [productCardSaving, setProductCardSaving] = useState(false);
  const [productCardDeleting, setProductCardDeleting] = useState(false);
  const codebookProductsRef = useRef(new Set());
  const codebookFeedRef = useRef(null);
  const codebookLoadMoreRef = useRef(null);

  const [activeRecount, setActiveRecount] = useState(null);
  const [values, setValues] = useState({});
  const [search, setSearch] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [hideCompletedItems, setHideCompletedItems] = useState(false);
  const [mismatchFilter, setMismatchFilter] = useState('all');

  const [barcodeCache, setBarcodeCache] = useState(() => loadBarcodeCache());

  const [mismatchModalOpen, setMismatchModalOpen] = useState(false);
  const [completeModalOpen, setCompleteModalOpen] = useState(false);
  const [unresolvedBarcode, setUnresolvedBarcode] = useState('');
  const [bindTargetBarcode, setBindTargetBarcode] = useState('');
  const [candidateCodes, setCandidateCodes] = useState([]);
  const [bindModalOpen, setBindModalOpen] = useState(false);
  const [bindSearch, setBindSearch] = useState('');
  const [counterName, setCounterName] = useState('');
  const [groupName, setGroupName] = useState('');
  const [includeTotalSummary, setIncludeTotalSummary] = useState(true);
  const [includeDiscrepancyTable, setIncludeDiscrepancyTable] = useState(false);
  const [updateCompletionTime, setUpdateCompletionTime] = useState(true);
  const [activeFactCode, setActiveFactCode] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [defaultCounterNameInput, setDefaultCounterNameInput] = useState('');
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [pendingInviteCode, setPendingInviteCode] = useState(() => {
    if (typeof localStorage === 'undefined') return '';
    return normalizeInviteCode(localStorage.getItem(PENDING_INVITE_KEY));
  });
  const [referralCodeInput, setReferralCodeInput] = useState('');
  const [referralActivating, setReferralActivating] = useState(false);
  const [referralStatus, setReferralStatus] = useState({ tone: '', message: '' });
  const [securityReferralData, setSecurityReferralData] = useState(null);
  const [securityReferralLoading, setSecurityReferralLoading] = useState(false);
  const [securityReferralError, setSecurityReferralError] = useState('');
  const [securityReferralStatus, setSecurityReferralStatus] = useState({ tone: '', message: '' });
  const [feedbackSoundEnabled, setFeedbackSoundEnabled] = useState(() => (
    localStorage.getItem(FEEDBACK_SOUND_STORAGE_KEY) !== '0'
  ));
  const [tsdOpen, setTsdOpen] = useState(() => (
    typeof window !== 'undefined' && window.location.pathname === '/tsd'
  ));
  const [keypadLabOpen, setKeypadLabOpen] = useState(() => (
    import.meta.env.DEV && typeof window !== 'undefined' && window.location.pathname === '/keypad-lab'
  ));
  const [codebookOpen, setCodebookOpen] = useState(() => (
    typeof window !== 'undefined' && window.location.pathname === '/codebook'
  ));
  const [qrOpen, setQrOpen] = useState(() => (
    typeof window !== 'undefined' && window.location.pathname === '/qr'
  ));
  const [tsdPriceModalOpen, setTsdPriceModalOpen] = useState(false);
  const [tsdPriceInput, setTsdPriceInput] = useState('');
  const [tsdResult, setTsdResult] = useState(null);
  const [tsdQrDataUrl, setTsdQrDataUrl] = useState('');
  const [tsdBarcodeDataUrl, setTsdBarcodeDataUrl] = useState('');

  const fileInputRef = useRef(null);
  const lastCodeRef = useRef('');
  const lastCodeTsRef = useRef(0);
  const pendingBarcodeRequestRef = useRef(new Map());
  const barcodeCacheRef = useRef(barcodeCache);
  const autosaveSnapshotRef = useRef('');
  const itemsFeedRef = useRef(null);
  const itemCardRefs = useRef(new Map());
  const keypadRef = useRef(null);
  const blurGuardUntilRef = useRef(0);
  const autoInviteAttemptRef = useRef('');
  const qrDecoderRef = useRef(new Decoder());
  const qrSubmittingRef = useRef(false);
  const [qrDecoderProgress, setQrDecoderProgress] = useState({ received: 0, required: 0, percent: 0 });
  const [qrTransferStatus, setQrTransferStatus] = useState('idle');
  const [qrTransferError, setQrTransferError] = useState('');
  const [qrDecodedPayload, setQrDecodedPayload] = useState(null);

  const resetQrTransfer = useCallback(() => {
    qrDecoderRef.current = new Decoder();
    qrSubmittingRef.current = false;
    setQrDecoderProgress({ received: 0, required: 0, percent: 0 });
    setQrTransferStatus('idle');
    setQrTransferError('');
    setQrDecodedPayload(null);
  }, []);

  const handleQrFrame = useCallback((rawFrame) => {
    try {
      const decoder = qrDecoderRef.current;
      decoder.addFrame(rawFrame);
      const after = decoder.progress();
      setQrDecoderProgress(after);
      setQrTransferError('');
      if (decoder.isComplete()) {
        const decodedBytes = decoder.data();
        const payload = JSON.parse(new TextDecoder().decode(decodedBytes));
        if (payload?.version !== 1 || !Array.isArray(payload.items)) {
          throw new Error('QR содержит объект неизвестного формата');
        }
        setQrDecodedPayload(payload);
        setQrTransferStatus('ok');
      } else {
        setQrTransferStatus('scanning');
      }
    } catch (error) {
      setQrTransferStatus('error');
      setQrTransferError(error instanceof Error ? error.message : 'Не удалось обработать QR-кадр');
    }
  }, []);

  const handleScannedCode = useCallback(async (code) => {
    const rawCode = String(code || '').trim();
    if (qrOpen) {
      handleQrFrame(rawCode);
      return;
    }
    const normalizedCode = normalizeScannedCode(rawCode);
    const now = Date.now();
    if (!normalizedCode) return;
    if (normalizedCode === lastCodeRef.current && now - lastCodeTsRef.current < 1500) return;

    lastCodeRef.current = normalizedCode;
    lastCodeTsRef.current = now;
    scanner.setLastCode(normalizedCode);
    setBindTargetBarcode(normalizedCode);

    if (tsdOpen) {
      if (rawCode.startsWith('CEN;')) {
        const qrResult = parseTsdQr(rawCode);
        if (!qrResult) {
          scanner.setScannerStatus('Неверный формат: ' + code);
          track('tsd_qr_rejected', { reason: 'invalid_format' });
          return;
        }
        setTsdResult({ ...qrResult, generated: false });
        scanner.setScannerStatus('QR-код считан');
        scanner.triggerScanSuccessFlash();
        triggerHaptic(70, 'scan');
        track('tsd_qr_scanned', { generated: false });
        return;
      }

      setTsdPriceInput('');
      setTsdPriceModalOpen(true);
      setTsdResult({ raw: '', barcode: String(code).trim(), price: '', date: '', generated: true });
      scanner.setScannerStatus('Введите цену товара');
      triggerHaptic(70, 'scan');
      return;
    }

    try {
      scanner.setScannerStatus('Поиск артикула...');
      const resolved = await resolveBarcodeWithCache(normalizedCode);
      const codes = resolved?.codes || [];

      if (resolved?.resolved && codes.length > 0) {
        // Find first code from resolved list that exists in active recount
        const activeItems = activeRecount?.items || [];
        const activeItemCodes = new Set(activeItems.map(item => String(item.code)));
        const matchedCode = codes.find(c => activeItemCodes.has(String(c)));

        if (matchedCode) {
          // Found matching code in current recount - auto-select it
          setSearch(String(matchedCode));
          scanner.setScannerStatus(`Штрихкод считан (${resolved.source || 'cache'})`);
          setUnresolvedBarcode('');
          setCandidateCodes(codes);
          scanner.triggerScanSuccessFlash();
          track('barcode_scanned', { area: 'recount', resolved: true });
          track('barcode_lookup_succeeded', { source: resolved.source || 'unknown' });
        } else {
          // No matching codes in active recount - set as unresolved
          scanner.setScannerStatus('Артикул не найден в просчете, поиск по штрихкоду');
          setUnresolvedBarcode(normalizedCode);
          setCandidateCodes(codes);
          track('barcode_lookup_no_match', { candidates_count: codes.length });
        }
      } else {
        // Not resolved or empty codes - set as unresolved
        setSearch(normalizedCode);
        scanner.setScannerStatus('Артикул не найден, поиск по штрихкоду');
        setUnresolvedBarcode(normalizedCode);
        setCandidateCodes([]);
        track('barcode_lookup_failed', { reason: 'not_found' });
      }
    } catch {
      setSearch(normalizedCode);
      scanner.setScannerStatus('Ошибка резолва, поиск по штрихкоду');
      setUnresolvedBarcode(normalizedCode);
      setCandidateCodes([]);
      track('barcode_lookup_failed', { reason: 'request_error' });
    }

    triggerHaptic(70, 'scan');
  }, [qrOpen, handleQrFrame, tsdOpen, activeRecount]);

  const scanner = useBarcodeScanner({
    activeRecount,
    tsdOpen,
    qrOpen,
    onScannedCode: handleScannedCode
  });

  useEffect(() => {
    if (!qrOpen) return undefined;
    const startTimer = window.setTimeout(() => void scanner.startScanner(), 0);
    return () => window.clearTimeout(startTimer);
  }, [qrOpen, user]);

  useEffect(() => {
    if (!qrOpen || !qrDecodedPayload || qrSubmittingRef.current) return;
    qrSubmittingRef.current = true;
    setQrTransferStatus('uploading');
    setQrTransferError('');

    void createRecountFromQr(qrDecodedPayload)
      .then(({ recount }) => {
        scanner.stopScanner();
        track('recount_created_from_qr');
        setActiveRecount(recount);
        setValues(recount.values || {});
        setSearch(recount.search || '');
        setBindTargetBarcode('');
        setActiveSummary(null);
        window.history.replaceState({}, '', '/');
        setQrOpen(false);
      })
      .catch(error => {
        qrSubmittingRef.current = false;
        setQrTransferStatus('error');
        setQrTransferError(error instanceof Error ? error.message : 'Не удалось создать просчет');
      });
  }, [qrOpen, qrDecodedPayload]);

  useEffect(() => {
    if (!activeFactCode) return undefined;

    const scrollActiveCard = () => {
      const feed = itemsFeedRef.current;
      const card = itemCardRefs.current.get(activeFactCode);
      const keypad = keypadRef.current;
      if (!feed || !card || !keypad) return;

      const cardRect = card.getBoundingClientRect();
      const keypadRect = keypad.getBoundingClientRect();
      const scrollDelta = cardRect.bottom - keypadRect.top;

      feed.scrollTo({
        top: Math.max(0, feed.scrollTop + scrollDelta),
        behavior: 'smooth'
      });
    };

    const delayedScroll = window.setTimeout(scrollActiveCard, 120);

    return () => {
      window.clearTimeout(delayedScroll);
    };
  }, [activeFactCode]);

  useEffect(() => {
    if (!activeFactCode) return undefined;

    const closeKeypadOnOutsidePointerDown = event => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.fact-keypad, .fact-input')) return;
      setActiveFactCode('');
    };

    document.addEventListener('pointerdown', closeKeypadOnOutsidePointerDown, true);
    return () => document.removeEventListener('pointerdown', closeKeypadOnOutsidePointerDown, true);
  }, [activeFactCode]);

  useEffect(() => {
    captureInviteFromUrl();
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const path = window.location.pathname;
      setTsdOpen(path === '/tsd');
      setKeypadLabOpen(path === '/keypad-lab');
      setQrOpen(path === '/qr');
      captureInviteFromUrl();
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [pendingInviteCode]);

  useEffect(() => {
    if (token || !pendingInviteCode) return;
    setAuthInviteBanner({
      tone: '',
      code: pendingInviteCode,
      message: 'Приглашение сохранено. Войдите или зарегистрируйтесь, чтобы применить код.'
    });
  }, [token, pendingInviteCode]);

  useEffect(() => {
    if (!user || !pendingInviteCode || user.isAdmin) {
      setHomeInviteNotice('');
      return;
    }

    if (user.subscriptionActive) {
      setHomeInviteNotice('Приглашение не применено: подписка уже активна.');
      return;
    }

    if (hasUsedReferralCode(user)) {
      setHomeInviteNotice('Приглашение не применено: для этого аккаунта код уже использован ранее.');
      if (!user.subscriptionActive) {
        setReferralStatus({
          tone: '',
          message: 'Приглашение не применено: для этого аккаунта реферальный код уже использован ранее.'
        });
      }
      return;
    }

    const attemptKey = `${user.id}:${pendingInviteCode}`;
    if (autoInviteAttemptRef.current === attemptKey) return;
    autoInviteAttemptRef.current = attemptKey;

    void applyReferralCode(pendingInviteCode, true);
  }, [user, pendingInviteCode]);

  useEffect(() => {
    if (!tsdResult?.raw) {
      setTsdQrDataUrl('');
      return undefined;
    }

    let cancelled = false;
    QRCode.toDataURL(tsdResult.raw, { margin: 1, width: 280 })
      .then(dataUrl => {
        if (!cancelled) setTsdQrDataUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setTsdQrDataUrl('');
      });

    return () => {
      cancelled = true;
    };
  }, [tsdResult]);

  useEffect(() => {
    if (!tsdResult?.barcode) {
      setTsdBarcodeDataUrl('');
      return undefined;
    }

    try {
      const barcodeCanvas = document.createElement('canvas');
      bwipjs.toCanvas(barcodeCanvas, {
        bcid: 'code128',
        text: tsdResult.barcode,
        scale: 3,
        height: 12,
        includetext: true,
        textxalign: 'center'
      });

      const frame = 16;
      const canvas = document.createElement('canvas');
      canvas.width = barcodeCanvas.width + frame * 2;
      canvas.height = barcodeCanvas.height + frame * 2;
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(barcodeCanvas, frame, frame);
      setTsdBarcodeDataUrl(canvas.toDataURL('image/png'));
    } catch {
      setTsdBarcodeDataUrl('');
    }

    return undefined;
  }, [tsdResult]);

  useEffect(() => {
    saveBarcodeCache(barcodeCache);
    barcodeCacheRef.current = barcodeCache;
  }, [barcodeCache]);

  useEffect(() => {
    localStorage.setItem(FEEDBACK_SOUND_STORAGE_KEY, feedbackSoundEnabled ? '1' : '0');
  }, [feedbackSoundEnabled]);

  useEffect(() => {
    if (!token) return;

    setAuthToken(token);
    me()
      .then(res => {
        const nextUser = res.user || null;
        setUser(nextUser);

        if (nextUser?.isAdmin) {
          return Promise.all([refreshAdminUsers(), refreshAdminLogs('all'), refreshAdminShopApiSettings(), refreshAdminPatchNotes(), refreshAdminContactLinks()]);
        }
        if (!nextUser?.subscriptionActive) {
          setActiveRecount(null);
          setActiveSummary(null);
          setPreviousRecounts([]);
          setPatchNotes([]);
          return;
        }
        return Promise.all([refreshDashboard(), refreshPatchNotes()]);
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

  const progressSummary = useMemo(() => {
    const items = activeRecount?.items || [];
    let totalDocQty = 0;
    let totalFactQty = 0;
    let totalSum = 0;

    for (const item of items) {
      const docQty = safeNumber(item.docQty);
      const raw = sanitizeFactExpression(valueMapForProgress(items, values)[item.code] ?? '');
      const factQty = raw ? sumFactExpression(raw) : null;
      totalDocQty += docQty;
      if (factQty !== null) {
        totalFactQty += factQty;
        const delta = factQty - docQty;
        const price = safeNumber(item.price);
        totalSum += delta * price;
      }
    }

    const denominator = Math.max(1, totalDocQty);
    const progressPercent = totalDocQty ? Math.min(100, (totalFactQty / denominator) * 100) : 0;
    return {
      totalDocQty,
      totalFactQty,
      totalSum,
      progressPercent: Number(progressPercent.toFixed(1))
    };
  }, [activeRecount, values]);

  const filteredItems = useMemo(() => {
    const items = activeRecount?.items || [];
    return items.filter(item => {
      const matchesQuery = matchesSearchQuery(search, item.code, item.name);
      if (!matchesQuery) return false;
      if (hideCompletedItems && computeRowState(item, values).delta === 0) return false;
      return true;
    });
  }, [activeRecount, search, hideCompletedItems, values]);

  const hiddenCompletedMatch = useMemo(() => {
    if (!hideCompletedItems || !search.trim()) return false;
    return (activeRecount?.items || []).some(item => {
      const matchesQuery = matchesSearchQuery(search, item.code, item.name);
      return matchesQuery && computeRowState(item, values).delta === 0;
    });
  }, [activeRecount, search, hideCompletedItems, values]);

  const bindFilteredItems = useMemo(() => {
    const items = activeRecount?.items || [];
    return items.filter(item => matchesSearchQuery(bindSearch, item.code, item.name));
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
      .filter(item => item.delta !== 0)
      .filter(item => mismatchFilter !== 'missing' || item.fact === null);
  }, [activeRecount, values, mismatchFilter]);

  const sortedPatchNotes = useMemo(() => sortPatchNotes(patchNotes), [patchNotes]);
  const sortedAdminPatchNotes = useMemo(() => sortPatchNotes(adminPatchNotes), [adminPatchNotes]);

  const filteredAdminUsers = useMemo(() => {
    let list = Array.isArray(adminUsers) ? adminUsers : [];
    const query = adminUserSearch.trim().toLowerCase();
    if (query) {
      list = list.filter(u => String(u.login || '').toLowerCase().includes(query) || String(u.id || '').toLowerCase().includes(query));
    }
    if (adminUserFilter === 'active') {
      list = list.filter(u => u.isAdmin || u.subscriptionActive);
    } else if (adminUserFilter === 'inactive') {
      list = list.filter(u => !u.isAdmin && !u.subscriptionActive);
    } else if (adminUserFilter === 'admin') {
      list = list.filter(u => u.isAdmin);
    }
    return list;
  }, [adminUsers, adminUserSearch, adminUserFilter]);

  const activeUsersCount = useMemo(() => {
    return adminUsers.filter(u => u.isAdmin || u.subscriptionActive).length;
  }, [adminUsers]);

  const inactiveUsersCount = useMemo(() => {
    return adminUsers.filter(u => !u.isAdmin && !u.subscriptionActive).length;
  }, [adminUsers]);

  const filteredAdminLogs = useMemo(() => {
    let list = Array.isArray(adminLogEntries) ? adminLogEntries : [];
    const query = adminLogSearch.trim().toLowerCase();
    if (query) {
      list = list.filter(entry => {
        const eventMatch = String(entry.event || '').toLowerCase().includes(query);
        const loginMatch = String(entry.actorLogin || '').toLowerCase().includes(query);
        const ipMatch = String(entry.ip || '').toLowerCase().includes(query);
        const metaMatch = entry.meta ? JSON.stringify(entry.meta).toLowerCase().includes(query) : false;
        return eventMatch || loginMatch || ipMatch || metaMatch;
      });
    }
    return list;
  }, [adminLogEntries, adminLogSearch]);

  const totalLogsCount = useMemo(() => {
    return Object.values(adminLogCounts || {}).reduce((acc, value) => acc + Number(value || 0), 0);
  }, [adminLogCounts]);

  function showAdminSuccess(msg) {
    setAdminSuccess(msg);
    setTimeout(() => {
      setAdminSuccess(prev => (prev === msg ? '' : prev));
    }, 4000);
  }

  function copyLogToClipboard(log) {
    try {
      navigator.clipboard.writeText(JSON.stringify(log, null, 2));
      setCopiedLogId(log.id);
      setTimeout(() => setCopiedLogId(prev => (prev === log.id ? '' : prev)), 2000);
    } catch {
      // ignore
    }
  }

  function setStoredPendingInvite(code) {
    const normalized = normalizeInviteCode(code);
    if (typeof localStorage !== 'undefined') {
      if (normalized) {
        localStorage.setItem(PENDING_INVITE_KEY, normalized);
      } else {
        localStorage.removeItem(PENDING_INVITE_KEY);
      }
    }
    setPendingInviteCode(normalized);
    return normalized;
  }

  function clearPendingInvite() {
    setStoredPendingInvite('');
    setAuthInviteBanner(null);
    autoInviteAttemptRef.current = '';
  }

  function getReferralErrorMessage(err) {
    const code = String(err?.payload?.code || '').toUpperCase();
    if (code === 'REFERRAL_EXPIRED') return 'Срок действия кода истек.';
    if (code === 'REFERRAL_REVOKED') return 'Код был отозван и больше не действует.';
    if (code === 'REFERRAL_ALREADY_USED') return 'Код уже использован этим пользователем.';
    if (code === 'REFERRAL_BLOCKED' || code === 'REFERRAL_RATE_LIMIT') return 'Слишком много попыток. Попробуйте позже.';
    if (code === 'REFERRAL_INVALID') return 'Код недействителен или недоступен.';

    const text = String(err?.message || '').toLowerCase();
    if (text.includes('просроч') || text.includes('истек')) return 'Срок действия кода истек.';
    if (text.includes('отозван')) return 'Код был отозван и больше не действует.';
    if (text.includes('использ')) return 'Код уже использован этим пользователем.';
    if (text.includes('блок') || text.includes('лимит')) return 'Слишком много попыток. Попробуйте позже.';
    if (text.includes('невалид') || text.includes('недейств')) return 'Код недействителен или недоступен.';
    return 'Не удалось активировать код. Проверьте его и попробуйте еще раз.';
  }

  function captureInviteFromUrl() {
    const inviteFromUrl = getInviteFromUrl();
    if (!inviteFromUrl) return;

    if (pendingInviteCode && pendingInviteCode !== inviteFromUrl) {
      setAuthInviteBanner({
        tone: '',
        code: pendingInviteCode,
        message: 'Уже сохранено приглашение. Очистите текущее, если нужно применить другой код.'
      });
      return;
    }

    const stored = setStoredPendingInvite(inviteFromUrl);
    if (!stored) return;

    setAuthInviteBanner({
      tone: '',
      code: stored,
      message: 'Найдено приглашение по ссылке. Код будет применен после входа или регистрации.'
    });
    setReferralStatus({ tone: '', message: '' });
  }

  async function refreshSecurityReferralData(account = user) {
    if (!isSecurityUserRole(account)) return;
    setSecurityReferralLoading(true);
    setSecurityReferralError('');
    setSecurityReferralStatus({ tone: '', message: '' });
    try {
      const data = await getMyReferralStats();
      const nextData = data?.referral || data || null;
      setSecurityReferralData(nextData);
    } catch (err) {
      setSecurityReferralError(err instanceof Error ? err.message : 'Не удалось загрузить статистику СБ');
    } finally {
      setSecurityReferralLoading(false);
    }
  }

  async function applyReferralCode(rawCode, automatic = false) {
    const code = normalizeInviteCode(rawCode);
    if (!code) {
      setReferralStatus({ tone: 'error', message: 'Введите корректный код из букв и цифр.' });
      return false;
    }

    setReferralActivating(true);
    setReferralStatus({ tone: '', message: automatic ? 'Пробуем активировать приглашение...' : '' });

    try {
      const result = await activateReferralCode({ code });
      const nextUser = result?.user || null;
      if (nextUser) {
        setUser(nextUser);
      }

      setStoredPendingInvite('');
      setReferralCodeInput('');
      setAuthInviteBanner({ tone: 'success', code: '', message: 'Код приглашения успешно применен.' });
      setReferralStatus({ tone: 'success', message: 'Пробный доступ активирован.' });

      if (nextUser?.subscriptionActive) {
        await Promise.all([refreshDashboard(), refreshPatchNotes()]);
      }
      return true;
    } catch (err) {
      setReferralStatus({ tone: 'error', message: getReferralErrorMessage(err) });
      return false;
    } finally {
      setReferralActivating(false);
    }
  }

  async function activateReferralManually() {
    const success = await applyReferralCode(referralCodeInput, false);
    if (success) {
      setHomeInviteNotice('');
    }
  }

  async function updateUserSecurityRole(targetUserId, enabled) {
    setActivatingUserId(targetUserId);
    setError('');
    try {
      await setUserSecurityRole(targetUserId, enabled);
      showAdminSuccess(enabled ? 'Роль СБ назначена' : 'Роль СБ снята');
      await refreshAdminUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось изменить роль СБ');
    } finally {
      setActivatingUserId('');
    }
  }

  async function issueUserReferralCode(targetUserId, regenerate) {
    setActivatingUserId(targetUserId);
    setError('');
    try {
      await issueUserReferralCodeApi(targetUserId, {
        regenerate: Boolean(regenerate),
        trialDays: Number(referralTrialDays) === 3 ? 3 : 1
      });
      showAdminSuccess(regenerate ? 'Код успешно перегенерирован' : 'Код успешно создан');
      await refreshAdminUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось выдать код приглашения');
    } finally {
      setActivatingUserId('');
    }
  }

  async function copySecurityInviteLink() {
    const code = normalizeInviteCode(securityReferralData?.code);
    if (!code) {
      setSecurityReferralError('Код не найден. Запросите выдачу у администратора.');
      setSecurityReferralStatus({ tone: '', message: '' });
      return;
    }

    const result = await copyTextWithFallback(buildInviteLink(code));
    if (result.ok) {
      setSecurityReferralError('');
      setSecurityReferralStatus({ tone: 'success', message: 'Инвайт-ссылка скопирована.' });
    } else {
      setSecurityReferralStatus({ tone: 'error', message: result.error || 'Не удалось скопировать ссылку.' });
    }
  }

  async function copyUserInviteLink(targetUser) {
    const code = normalizeInviteCode(targetUser?.referralCode || targetUser?.securityReferralCode || targetUser?.referral?.code);
    if (!code) {
      setError('У пользователя пока нет кода приглашения.');
      return;
    }

    const result = await copyTextWithFallback(buildInviteLink(code));
    if (result.ok) {
      showAdminSuccess('Инвайт-ссылка скопирована');
    } else {
      setError(result.error || 'Не удалось скопировать ссылку');
    }
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

  async function refreshPatchNotes() {
    setPatchNotesLoading(true);
    setPatchNotesError('');
    try {
      const data = await getPatchNotes();
      setPatchNotes(Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      setPatchNotesError(err instanceof Error ? err.message : 'Не удалось загрузить патчноуты');
    } finally {
      setPatchNotesLoading(false);
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

  async function refreshAdminLogs(level = adminLogLevel, group = adminLogGroup, users = adminLogSelectedUsers) {
    setAdminLogLoading(true);
    setError('');
    try {
      const data = await getAdminLogs(level, 250, { group, users });
      setAdminLogLevel(data?.selectedLevel || level);
      setAdminLogGroup(data?.selectedGroup || group);
      setAdminLogSelectedUsers(Array.isArray(data?.selectedActorKeys) ? data.selectedActorKeys : users);
      setAdminLogUsers(Array.isArray(data?.users) ? data.users : []);
      setAdminLogEntries(Array.isArray(data?.entries) ? data.entries : []);
      setAdminLogCounts(data?.levelCounts && typeof data.levelCounts === 'object' ? data.levelCounts : {});
      setAdminLogGroupCounts(data?.groupCounts && typeof data.groupCounts === 'object' ? data.groupCounts : {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить логи');
    } finally {
      setAdminLogLoading(false);
    }
  }

  async function refreshAdminShopApiSettings() {
    try {
      const data = await getAdminShopApiSettings();
      setShopApiTokenStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить настройки API магазина');
    }
  }

  async function refreshAdminContactLinks() {
    try {
      const data = await getAdminContactLinks();
      setAdminContactLinks(data?.links || { telegramUrl: '', maxUrl: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить ссылки для связи');
    }
  }

  async function refreshAdminPatchNotes() {
    setAdminPatchNotesLoading(true);
    setError('');
    try {
      const data = await getAdminPatchNotes();
      setAdminPatchNotes(Array.isArray(data?.items) ? data.items : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить патчноуты для админки');
    } finally {
      setAdminPatchNotesLoading(false);
    }
  }

  async function refreshCodebook(nextFilter = codebookFilter, nextPage = 1, append = false) {
    if (!user) return;
    if (append) setCodebookLoadingMore(true);
    else setCodebookLoading(true);
    setError('');
    try {
      const service = user.isAdmin ? getAdminCodebook : getSecurityCodebook;
      const data = await service(nextFilter, nextPage, 12);
      setCodebookData({
        entries: append
          ? [...(codebookData.entries || []), ...(Array.isArray(data?.entries) ? data.entries : [])]
          : (Array.isArray(data?.entries) ? data.entries : []),
        total: Number(data?.total || 0),
        page: Number(data?.page || nextPage || 1),
        limit: Number(data?.limit || 12),
        totalPages: Number(data?.totalPages || 1),
        stats: data?.stats || {}
      });
      setCodebookPage(Number(data?.page || nextPage || 1));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить справочник кодов');
    } finally {
      if (append) setCodebookLoadingMore(false);
      else setCodebookLoading(false);
    }
  }

  useEffect(() => {
    if (!user) return;
    const canViewCodebook = user.isAdmin || isSecurityUserRole(user);
    if (!canViewCodebook) return;
    if (!codebookOpen) return;
    setCodebookProducts({});
    codebookProductsRef.current = new Set();
    void refreshCodebook(codebookFilter, 1);
  }, [user, codebookOpen, codebookFilter]);

  useEffect(() => {
    const entries = codebookData.entries || [];
    const pendingEntries = entries.filter(entry => (
      !codebookProductsRef.current.has(String(entry.code))
    ));
    if (!pendingEntries.length || !user) return;

    pendingEntries.forEach(entry => codebookProductsRef.current.add(String(entry.code)));
    const service = user.isAdmin ? getAdminProductByCode : getSecurityProductByCode;
    let cancelled = false;
    Promise.all(pendingEntries.map(async entry => {
      try {
        const data = await service(entry.code);
        return [String(entry.code), data?.product || null];
      } catch {
        return [String(entry.code), null];
      }
    })).then(results => {
      if (cancelled) return;
      setCodebookProducts(current => ({
        ...current,
        ...Object.fromEntries(results)
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [codebookData.entries, user]);

  async function loadMoreCodebook() {
    if (codebookLoading || codebookLoadingMore || codebookPage >= (codebookData.totalPages || 1)) return;
    await refreshCodebook(codebookFilter, codebookPage + 1, true);
  }

  useEffect(() => {
    const target = codebookLoadMoreRef.current;
    const root = codebookFeedRef.current;
    if (!target || !root) return undefined;
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting) void loadMoreCodebook();
    }, { root, rootMargin: '500px 0px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, [codebookPage, codebookData.totalPages, codebookLoading, codebookLoadingMore, codebookFilter]);

  async function openProductCard(articleCode) {
    if (!articleCode) return;
    setProductCardError('');
    setProductCardLoading(true);
    try {
      const isAdminMode = Boolean(user?.isAdmin);
      const data = isAdminMode
        ? await getAdminProductByCode(articleCode)
        : await getSecurityProductByCode(articleCode);
      const entry = (codebookData.entries || []).find(item => String(item.code) === String(articleCode));
      setProductCard({
        articleCode: String(articleCode),
        product: data?.product || codebookProducts[String(articleCode)] || null,
        barcodes: Array.isArray(entry?.barcodes) ? entry.barcodes : [],
        originalBarcodes: Array.isArray(entry?.barcodes) ? entry.barcodes : [],
        editing: false
      });
    } catch (err) {
      setProductCardError(err instanceof Error ? err.message : 'Не удалось загрузить карточку товара');
      setProductCard({ articleCode: String(articleCode), barcodes: [], product: null, editing: false });
    } finally {
      setProductCardLoading(false);
    }
  }

  async function saveProductCard() {
    if (!productCard?.articleCode || productCardSaving) return;
    setProductCardSaving(true);
    setError('');
    try {
      const update = user?.isAdmin ? updateAdminCodebookEntry : updateSecurityCodebookEntry;
      await update(productCard.articleCode, productCard.barcodes);
      setProductCard(current => current ? { ...current, originalBarcodes: [...current.barcodes], editing: false } : current);
      await refreshCodebook(codebookFilter, codebookPage);
      setAdminSuccess(user?.isAdmin ? 'Связь кода товара сохранена' : 'Связь товара сохранена');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить связь кода товара');
    } finally {
      setProductCardSaving(false);
    }
  }

  async function deleteProductCard(articleCode) {
    if (!articleCode || productCardDeleting) return;
    if (typeof window !== 'undefined' && !window.confirm(`Удалить связь для кода ${articleCode}?`)) return;
    setProductCardDeleting(true);
    setError('');
    try {
      const remove = user?.isAdmin ? deleteAdminCodebookEntry : deleteSecurityCodebookEntry;
      await remove(articleCode);
      setProductCard(null);
      await refreshCodebook(codebookFilter, codebookPage);
      setAdminSuccess(user?.isAdmin ? 'Связь кода товара удалена' : 'Связь товара удалена');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось удалить связь кода товара');
    } finally {
      setProductCardDeleting(false);
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
      await Promise.all([refreshAdminUsers(), refreshAdminLogs('all'), refreshAdminShopApiSettings(), refreshAdminPatchNotes(), refreshAdminContactLinks()]);
      return;
    }

    if (!nextUser?.subscriptionActive) {
      return;
    }

    await Promise.all([refreshDashboard(), refreshPatchNotes()]);
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    setAuthLoading(true);
    setAuthError('');

    try {
      const action = authMode === 'register' ? register : login;
      const result = await action(authLogin, authPassword);
      await bootstrapAuth(result);
      track('auth_succeeded', { mode: authMode });
      setAuthPassword('');
    } catch (err) {
      track('auth_failed', { mode: authMode });
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

    scanner.stopScanner();
    localStorage.removeItem(TOKEN_KEY);
    setAuthToken('');
    setToken('');
    setUser(null);
    setActiveSummary(null);
    setPreviousRecounts([]);
    setAdminUsers([]);
    setAdminLogLevel('all');
    setAdminLogEntries([]);
    setAdminLogUsers([]);
    setAdminLogCounts({});
    setAdminLogGroupCounts({});
    setPatchNotes([]);
    setPatchNotesError('');
    setExpandedPatchNotes({});
    setAdminPatchNotes([]);
    setActiveRecount(null);
    setValues({});
    setSearch('');
    setAuthInviteBanner(null);
    setHomeInviteNotice('');
    setReferralCodeInput('');
    setReferralStatus({ tone: '', message: '' });
    setSecurityReferralData(null);
    setSecurityReferralError('');
    setSecurityReferralStatus({ tone: '', message: '' });
    setMenuOpen(false);
    setMismatchModalOpen(false);
    setCompleteModalOpen(false);
    setSettingsOpen(false);
    setExpandedUserId('');
  }

  function togglePatchNoteExpanded(id) {
    setExpandedPatchNotes(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  }

  function updateAdminPatchNoteField(id, field, value) {
    setAdminPatchNotes(prev => prev.map(item => (
      String(item.id) === String(id)
        ? { ...item, [field]: value }
        : item
    )));
  }

  async function createPatchNoteFromAdmin() {
    const title = newPatchNoteTitle.trim();
    const text = newPatchNoteText.trim();
    const date = newPatchNoteDate.trim();
    if (!title || !text || !date) {
      setError('Заполните дату, заголовок и текст патчноута');
      return;
    }

    setAdminPatchNotesSavingId('new');
    setError('');
    try {
      await createAdminPatchNote({ date, title, text });
      setNewPatchNoteTitle('');
      setNewPatchNoteText('');
      setAdminNewPatchNoteOpen(false);
      showAdminSuccess('Патчноут успешно создан');
      await Promise.all([refreshAdminPatchNotes(), refreshPatchNotes()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать патчноут');
    } finally {
      setAdminPatchNotesSavingId('');
    }
  }

  async function savePatchNoteFromAdmin(item) {
    const normalized = normalizePatchNote(item);
    if (!normalized.id || !normalized.date || !normalized.title || !normalized.text) {
      setError('Поля date, title и text обязательны для сохранения');
      return;
    }

    setAdminPatchNotesSavingId(normalized.id);
    setError('');
    try {
      await updateAdminPatchNote(normalized.id, {
        date: normalized.date,
        title: normalized.title,
        text: normalized.text
      });
      showAdminSuccess('Патчноут успешно сохранен');
      await Promise.all([refreshAdminPatchNotes(), refreshPatchNotes()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить патчноут');
    } finally {
      setAdminPatchNotesSavingId('');
    }
  }

  async function deletePatchNoteFromAdmin(id) {
    if (!window.confirm('Удалить патчноут без возможности восстановления?')) return;
    const normalizedId = String(id || '').trim();
    if (!normalizedId) return;

    setAdminPatchNotesDeletingId(normalizedId);
    setError('');
    try {
      await deleteAdminPatchNote(normalizedId);
      showAdminSuccess('Патчноут успешно удален');
      await Promise.all([refreshAdminPatchNotes(), refreshPatchNotes()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось удалить патчноут');
    } finally {
      setAdminPatchNotesDeletingId('');
    }
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
      track('recount_opened', { source: 'active' });
      setActiveRecount(recount);
      setValues(recount.values || {});
      setSearch(recount.search || '');
      setUnresolvedBarcode('');
      setBindTargetBarcode('');
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
      track('recount_reopened', { source: 'history' });
      setActiveRecount(recount);
      setValues(recount.values || {});
      setSearch(recount.search || '');
      setMenuOpen(false);
      setMismatchModalOpen(false);
      setCompleteModalOpen(false);
      setUnresolvedBarcode('');
      setBindTargetBarcode('');
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
      track('recount_created_from_pdf');
      setActiveRecount(recount);
      setValues(recount.values || {});
      setSearch(recount.search || '');
      setBindTargetBarcode('');
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
      scanner.setScannerStatus('Прогресс сохранен');
    } catch {
      scanner.setScannerStatus('Ошибка сохранения');
    }

    setMenuOpen(false);
  }

  async function resolveBarcodeWithCache(rawBarcode) {
    const barcode = normalizeBarcodeValue(rawBarcode);
    if (!barcode) {
      return { resolved: false, codes: [], source: 'empty' };
    }

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

    const requestPromise = resolveBarcode(barcode, getItemCodes(), activeRecount?.id)
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

  function confirmTsdPrice() {
    const price = normalizeTsdPrice(tsdPriceInput);
    if (!price || !tsdResult?.barcode) {
      setError('Введите цену в формате 00.00 или 00,00');
      track('tsd_price_rejected', { reason: 'invalid_format' });
      return;
    }

    const raw = `CEN;${tsdResult.barcode};${price};1;6;${formatTsdDate()}`;
    setTsdResult({
      raw,
      barcode: tsdResult.barcode,
      price,
      date: formatTsdDate(),
      generated: true
    });
    setTsdPriceModalOpen(false);
    setError('');
    scanner.setScannerStatus('QR-код сформирован');
    scanner.triggerScanSuccessFlash();
    track('tsd_qr_generated', { source: 'barcode' });
  }

  function openTsd() {
    scanner.stopScanner();
    window.history.pushState({}, '', '/tsd');
    setTsdOpen(true);
    setKeypadLabOpen(false);
    setTsdResult(null);
    setTsdPriceModalOpen(false);
    scanner.setScannerStatus('Сканер выключен');
    track('tsd_opened');
  }

  function closeTsd() {
    scanner.stopScanner();
    window.history.replaceState({}, '', '/');
    setTsdOpen(false);
    setTsdResult(null);
    setTsdPriceModalOpen(false);
  }

  function closeQr() {
    scanner.stopScanner();
    window.history.replaceState({}, '', '/');
    setQrOpen(false);
    resetQrTransfer();
  }

  function openQr() {
    scanner.stopScanner();
    resetQrTransfer();
    window.history.pushState({}, '', '/qr');
    setQrOpen(true);
  }

  function openCodebook() {
    scanner.stopScanner();
    window.history.pushState({}, '', '/codebook');
    setCodebookOpen(true);
    setAdminTab('users');
    setHomeTab('recounts');
    setProductCard(null);
  }

  function closeCodebook() {
    window.history.replaceState({}, '', '/');
    setCodebookOpen(false);
    setProductCard(null);
  }

  function closeKeypadLab() {
    window.history.replaceState({}, '', '/');
    setKeypadLabOpen(false);
  }

  function openBindModal() {
    const targetBarcode = normalizeBarcodeValue(bindTargetBarcode || unresolvedBarcode || scanner.lastCode);
    if (!targetBarcode) {
      scanner.setScannerStatus('Сначала отсканируйте штрихкод');
      return;
    }
    setBindTargetBarcode(targetBarcode);
    setBindSearch('');
    setBindModalOpen(true);
  }

  function closeBindModal() {
    setBindModalOpen(false);
    setBindSearch('');
  }

  async function bindBarcodeToSelectedItem(itemCode) {
    const barcode = normalizeBarcodeValue(bindTargetBarcode || unresolvedBarcode || scanner.lastCode);
    if (!barcode) return;
    if (!activeRecount?.id) return;

    const normalizedItemCode = String(itemCode);

    try {
      await bindBarcodeToItem({
        barcode,
        itemCode: normalizedItemCode,
        recountId: activeRecount.id
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось привязать штрихкод');
      return;
    }

    // Update local cache without removing code from other barcodes
    setBarcodeCache(prev => reassignBarcodeToItem(prev, barcode, normalizedItemCode));

    setSearch(normalizedItemCode);
    scanner.setScannerStatus('Штрихкод привязан вручную');
    setUnresolvedBarcode('');
    setCandidateCodes([normalizedItemCode]);
    closeBindModal();
    scanner.triggerScanSuccessFlash();
    triggerHaptic(70, 'scan');
    track('barcode_bound_manually');
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
    if (Date.now() < blurGuardUntilRef.current) return;
    setActiveFactCode('');
  }

  function keepFactKeypadOpen() {
    blurGuardUntilRef.current = Date.now() + 600;
  }

  function appendToActiveFact(char) {
    if (!activeFactCode) return;
    triggerHaptic(18, 'tap');
    setValues(prev => {
      const current = String(prev[activeFactCode] ?? '');
      if (char === '+') {
        if (!current || current.endsWith('+')) return prev;
        return { ...prev, [activeFactCode]: sanitizeFactExpression(`${current}+`) };
      }

      if (/^\d$/.test(char)) {
        return { ...prev, [activeFactCode]: sanitizeFactExpression(`${current}${char}`) };
      }

      return prev;
    });
  }

  function eraseActiveFact() {
    if (!activeFactCode) return;
    triggerHaptic(18, 'tap');
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
        includeDiscrepancyTable,
        updateCompletionTime
      });
      markCompletionSurveyPending();
      track('recount_completed', { has_pdf: true });

      const fileName = result.fileName.toLowerCase().endsWith('.pdf')
        ? result.fileName
        : `${result.fileName}.pdf`;
      const pdfFile = new File([result.blob], fileName, { type: 'application/pdf' });
      const url = URL.createObjectURL(pdfFile);

      if (navigator.share && navigator.canShare?.({ files: [pdfFile] })) {
        try {
          await navigator.share({
            files: [pdfFile],
            title: fileName
          });
        } catch (shareError) {
          if (shareError?.name !== 'AbortError') {
            console.warn('Не удалось поделиться PDF', shareError);
          }
        }
      } else {
        const link = document.createElement('a');
        link.href = url;
        link.download = fileName;
        link.click();
      }

      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);

      setCompleteModalOpen(false);
      setCounterName('');
      setGroupName('');

      scanner.stopScanner();
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
    setIncludeDiscrepancyTable(false);
    setUpdateCompletionTime(true);
    setCompleteModalOpen(true);
  }

  async function handleFinishWithoutPdf() {
    if (!activeRecount) return;

    setMenuOpen(false);
    setLoading(true);
    setError('');

    try {
      const progressPayload = buildProgressPayload(values, search, barcodeCache);
      await finishRecountWithoutPdf(activeRecount.id, {
        ...progressPayload,
        includeDiscrepancyTable,
        updateCompletionTime
      });
      track('recount_completed', { has_pdf: false });

      setCompleteModalOpen(false);
      setCounterName('');
      setGroupName('');

      scanner.stopScanner();
      setActiveRecount(null);
      await refreshDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось завершить просчет');
    } finally {
      setLoading(false);
    }
  }

  async function goHome() {
    scanner.stopScanner();
    setActiveRecount(null);
    setMenuOpen(false);
    setMismatchModalOpen(false);
    setCompleteModalOpen(false);
    setUnresolvedBarcode('');
    setBindTargetBarcode('');
    setCandidateCodes([]);
    setBindModalOpen(false);
    await refreshDashboard();
  }

  async function activateSubscriptionForUser(targetUserId, customDays) {
    const parsedDays = Number.parseInt(customDays !== undefined ? customDays : activationDays, 10);
    const days = Number.isFinite(parsedDays) ? Math.max(1, Math.min(parsedDays, 3650)) : 30;

    setActivatingUserId(targetUserId);
    setError('');
    try {
      await activateUserSubscription(targetUserId, { days });
      showAdminSuccess(`Подписка успешно активирована (+${days} дн.)`);
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
      showAdminSuccess('Привязка устройства сброшена');
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
      showAdminSuccess('Аккаунт успешно удален');
      await refreshAdminUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось удалить пользователя');
    } finally {
      setDeletingUserId('');
    }
  }

  async function deletePreviousRecount(recountId) {
    if (!window.confirm('Удалить этот просчет без возможности восстановления?')) return;

    setDeletingRecountId(recountId);
    setError('');
    try {
      await deleteRecount(recountId);
      await refreshDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось удалить просчет');
    } finally {
      setDeletingRecountId('');
    }
  }

  async function deleteActiveRecount() {
    if (!activeRecount || !window.confirm('Удалить текущий просчет без возможности восстановления?')) return;

    setDeletingRecountId(activeRecount.id);
    setError('');
    try {
      await deleteRecount(activeRecount.id);
      scanner.stopScanner();
      setActiveRecount(null);
      setValues({});
      setSearch('');
      setMenuOpen(false);
      await refreshDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось удалить просчет');
    } finally {
      setDeletingRecountId('');
    }
  }

  async function saveShopApiToken() {
    const tokenInput = shopApiTokenInput.trim();
    if (!tokenInput) {
      setError('Введите токен API магазина');
      return;
    }

    setShopApiTokenSaving(true);
    setError('');
    try {
      const data = await updateAdminShopApiToken(tokenInput);
      setShopApiTokenStatus(data);
      setShopApiTokenInput('');
      showAdminSuccess('Токен API магазина успешно сохранен');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить токен API магазина');
    } finally {
      setShopApiTokenSaving(false);
    }
  }

  async function saveContactLinks() {
    setError('');
    setAdminContactLinksSaving(true);
    try {
      const data = await updateAdminContactLinks({
        telegramUrl: adminContactLinks.telegramUrl,
        maxUrl: adminContactLinks.maxUrl
      });
      setAdminContactLinks(data?.links || adminContactLinks);
      setUser(prev => prev ? { ...prev, supportLinks: data?.links || prev.supportLinks } : prev);
      showAdminSuccess('Ссылки для связи успешно сохранены');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить ссылки для связи');
    } finally {
      setAdminContactLinksSaving(false);
    }
  }

  async function toggleDeviceBinding(targetUser) {
    setActivatingUserId(targetUser.id);
    setError('');
    const willDisable = !targetUser.deviceBindingDisabled;
    try {
      await setUserDeviceBindingDisabled(targetUser.id, willDisable);
      showAdminSuccess(willDisable ? 'Ограничение устройства отключено' : 'Ограничение устройства включено');
      await refreshAdminUsers();
      await refreshAdminLogs(adminLogLevel);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось изменить ограничение привязки');
    } finally {
      setActivatingUserId('');
    }
  }

  function openSettings() {
    setDefaultCounterNameInput(user?.defaultCounterName || '');
    setSettingsOpen(true);
    if (isSecurityUserRole(user)) {
      void refreshSecurityReferralData(user);
    }
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

  if (import.meta.env.DEV && keypadLabOpen) {
    return <KeypadSandboxPage onClose={closeKeypadLab} />;
  }

  const codebookPageProps = {
    user,
    error,
    codebookData,
    codebookFilter,
    setCodebookFilter,
    codebookPage,
    codebookLoading,
    codebookLoadingMore,
    codebookProducts,
    codebookFeedRef,
    codebookLoadMoreRef,
    codebookSearch,
    setCodebookSearch,
    openProductCard,
    productCard,
    setProductCard,
    productCardLoading,
    productCardError,
    productCardSaving,
    productCardDeleting,
    saveProductCard,
    deleteProductCard,
    closeCodebook
  };

  if (!token && !tsdOpen) {
    return (
      <AuthPage
        authMode={authMode}
        setAuthMode={setAuthMode}
        authLogin={authLogin}
        setAuthLogin={setAuthLogin}
        authPassword={authPassword}
        setAuthPassword={setAuthPassword}
        authLoading={authLoading}
        authError={authError}
        setAuthError={setAuthError}
        handleAuthSubmit={handleAuthSubmit}
        inviteBanner={authInviteBanner}
        clearPendingInvite={pendingInviteCode ? clearPendingInvite : null}
      />
    );
  }

  if (user?.isAdmin) {
    if (codebookOpen) return <CodebookPage {...codebookPageProps} />;
    return (
      <AdminPage
        user={user}
        handleLogout={handleLogout}
        adminSuccess={adminSuccess}
        setAdminSuccess={setAdminSuccess}
        error={error}
        setError={setError}
        adminTab={adminTab}
        setAdminTab={setAdminTab}
        adminUsers={adminUsers}
        totalLogsCount={totalLogsCount}
        sortedAdminPatchNotes={sortedAdminPatchNotes}
        refreshAdminShopApiSettings={refreshAdminShopApiSettings}
        refreshAdminContactLinks={refreshAdminContactLinks}
        refreshAdminPatchNotes={refreshAdminPatchNotes}
        adminUserSearch={adminUserSearch}
        setAdminUserSearch={setAdminUserSearch}
        adminUserFilter={adminUserFilter}
        setAdminUserFilter={setAdminUserFilter}
        filteredAdminUsers={filteredAdminUsers}
        activeUsersCount={activeUsersCount}
        inactiveUsersCount={inactiveUsersCount}
        activationDays={activationDays}
        setActivationDays={setActivationDays}
        activatingUserId={activatingUserId}
        homeLoading={homeLoading}
        refreshAdminUsers={refreshAdminUsers}
        activateSubscriptionForUser={activateSubscriptionForUser}
        setExpandedUserId={setExpandedUserId}
        adminLogLevel={adminLogLevel}
        refreshAdminLogs={refreshAdminLogs}
        adminLogLoading={adminLogLoading}
        adminLogSearch={adminLogSearch}
        setAdminLogSearch={setAdminLogSearch}
        setAdminLogVisibleLimit={setAdminLogVisibleLimit}
        adminLogVisibleLimit={adminLogVisibleLimit}
        adminLogCounts={adminLogCounts}
        adminLogGroupCounts={adminLogGroupCounts}
        adminLogGroup={adminLogGroup}
        adminLogUsers={adminLogUsers}
        adminLogSelectedUsers={adminLogSelectedUsers}
        filteredAdminLogs={filteredAdminLogs}
        copiedLogId={copiedLogId}
        copyLogToClipboard={copyLogToClipboard}
        adminNewPatchNoteOpen={adminNewPatchNoteOpen}
        setAdminNewPatchNoteOpen={setAdminNewPatchNoteOpen}
        adminPatchNotesLoading={adminPatchNotesLoading}
        newPatchNoteDate={newPatchNoteDate}
        setNewPatchNoteDate={setNewPatchNoteDate}
        newPatchNoteTitle={newPatchNoteTitle}
        setNewPatchNoteTitle={setNewPatchNoteTitle}
        newPatchNoteText={newPatchNoteText}
        setNewPatchNoteText={setNewPatchNoteText}
        createPatchNoteFromAdmin={createPatchNoteFromAdmin}
        adminPatchNotesSavingId={adminPatchNotesSavingId}
        adminPatchNotesDeletingId={adminPatchNotesDeletingId}
        updateAdminPatchNoteField={updateAdminPatchNoteField}
        savePatchNoteFromAdmin={savePatchNoteFromAdmin}
        deletePatchNoteFromAdmin={deletePatchNoteFromAdmin}
        shopApiTokenStatus={shopApiTokenStatus}
        shopApiTokenInput={shopApiTokenInput}
        setShopApiTokenInput={setShopApiTokenInput}
        saveShopApiToken={saveShopApiToken}
        shopApiTokenSaving={shopApiTokenSaving}
        adminContactLinks={adminContactLinks}
        setAdminContactLinks={setAdminContactLinks}
        saveContactLinks={saveContactLinks}
        adminContactLinksSaving={adminContactLinksSaving}
        expandedUserId={expandedUserId}
        resetDeviceBindingForUser={resetDeviceBindingForUser}
        toggleDeviceBinding={toggleDeviceBinding}
        deleteUserAccount={deleteUserAccount}
        deletingUserId={deletingUserId}
        updateUserSecurityRole={updateUserSecurityRole}
        issueUserReferralCode={issueUserReferralCode}
        copyUserInviteLink={copyUserInviteLink}
        referralTrialDays={referralTrialDays}
        setReferralTrialDays={setReferralTrialDays}
        codebookData={codebookData}
        codebookFilter={codebookFilter}
        setCodebookFilter={setCodebookFilter}
        codebookPage={codebookPage}
        setCodebookPage={setCodebookPage}
        codebookLoading={codebookLoading}
        codebookLoadingMore={codebookLoadingMore}
        codebookProducts={codebookProducts}
        codebookFeedRef={codebookFeedRef}
        codebookLoadMoreRef={codebookLoadMoreRef}
        refreshCodebook={refreshCodebook}
        openProductCard={openProductCard}
        productCard={productCard}
        setProductCard={setProductCard}
        codebookSearch={codebookSearch}
        setCodebookSearch={setCodebookSearch}
        productCardLoading={productCardLoading}
        productCardError={productCardError}
        productCardSaving={productCardSaving}
        productCardDeleting={productCardDeleting}
        saveProductCard={saveProductCard}
        deleteProductCard={deleteProductCard}
        codebookConflictOnly={codebookFilter === 'conflict'}
        openCodebook={openCodebook}
      />
    );
  }

  if (user && !user.subscriptionActive) {
    return (
      <SubscriptionExpiredPage
        user={user}
        handleLogout={handleLogout}
        referralCode={referralCodeInput}
        setReferralCode={setReferralCodeInput}
        referralActivating={referralActivating}
        activateReferral={activateReferralManually}
        referralStatus={referralStatus}
        pendingInviteCode={pendingInviteCode}
        clearPendingInvite={clearPendingInvite}
      />
    );
  }

  if (codebookOpen && user && isSecurityUserRole(user)) {
    return <CodebookPage {...codebookPageProps} />;
  }

  if (tsdOpen) {
    return (
      <TsdPage
        scanSuccessFlash={scanner.scanSuccessFlash}
        scannerOn={scanner.scannerOn}
        toggleScanner={scanner.toggleScanner}
        torchOn={scanner.torchOn}
        toggleTorch={scanner.toggleTorch}
        videoRef={scanner.videoRef}
        focusScannerCamera={scanner.focusScannerCamera}
        handleScannerDoubleClick={scanner.handleScannerDoubleClick}
        scannerStatus={scanner.scannerStatus}
        lastCode={scanner.lastCode}
        tsdResult={tsdResult}
        tsdQrDataUrl={tsdQrDataUrl}
        tsdBarcodeDataUrl={tsdBarcodeDataUrl}
        closeTsd={closeTsd}
        tsdPriceModalOpen={tsdPriceModalOpen}
        setTsdPriceModalOpen={setTsdPriceModalOpen}
        tsdPriceInput={tsdPriceInput}
        setTsdPriceInput={setTsdPriceInput}
        confirmTsdPrice={confirmTsdPrice}
      />
    );
  }

  if (qrOpen) {
    return (
      <QrTestPage
        scannerOn={scanner.scannerOn}
        startScanner={scanner.startScanner}
        videoRef={scanner.videoRef}
        focusScannerCamera={scanner.focusScannerCamera}
        scannerStatus={scanner.scannerStatus}
        decoderProgress={qrDecoderProgress}
        transferStatus={qrTransferStatus}
        transferError={qrTransferError}
        decodedPayload={qrDecodedPayload}
        close={closeQr}
      />
    );
  }

  if (!activeRecount) {
    return (
      <HomePage
        fileInputRef={fileInputRef}
        handleUpload={handleUpload}
        openQr={openQr}
        user={user}
        openSettings={openSettings}
        handleLogout={handleLogout}
        error={error}
        homeLoading={homeLoading}
        activeSummary={activeSummary}
        openRecount={openRecount}
        loading={loading}
        homeTab={homeTab}
        setHomeTab={setHomeTab}
        previousRecounts={previousRecounts}
        reopenPreviousRecount={reopenPreviousRecount}
        deletePreviousRecount={deletePreviousRecount}
        deletingRecountId={deletingRecountId}
        patchNotesLoading={patchNotesLoading}
        patchNotesError={patchNotesError}
        patchNotes={patchNotes}
        refreshPatchNotes={refreshPatchNotes}
        sortedPatchNotes={sortedPatchNotes}
        expandedPatchNotes={expandedPatchNotes}
        togglePatchNoteExpanded={togglePatchNoteExpanded}
        openTsd={openTsd}
        settingsOpen={settingsOpen}
        closeSettings={closeSettings}
        defaultCounterNameInput={defaultCounterNameInput}
        setDefaultCounterNameInput={setDefaultCounterNameInput}
        feedbackSoundEnabled={feedbackSoundEnabled}
        setFeedbackSoundEnabled={setFeedbackSoundEnabled}
        saveAccountSettings={saveAccountSettings}
        settingsSaving={settingsSaving}
        isSecurityUser={isSecurityUserRole(user)}
        securityReferralData={securityReferralData}
        securityReferralLoading={securityReferralLoading}
        securityReferralError={securityReferralError}
        securityReferralStatus={securityReferralStatus}
        refreshSecurityReferralData={refreshSecurityReferralData}
        copySecurityInviteLink={copySecurityInviteLink}
        inviteNotice={homeInviteNotice}
        codebookData={codebookData}
        codebookFilter={codebookFilter}
        setCodebookFilter={setCodebookFilter}
        codebookPage={codebookPage}
        setCodebookPage={setCodebookPage}
        codebookLoading={codebookLoading}
        codebookLoadingMore={codebookLoadingMore}
        codebookProducts={codebookProducts}
        codebookFeedRef={codebookFeedRef}
        codebookLoadMoreRef={codebookLoadMoreRef}
        refreshCodebook={refreshCodebook}
        openProductCard={openProductCard}
        productCard={productCard}
        setProductCard={setProductCard}
        codebookSearch={codebookSearch}
        setCodebookSearch={setCodebookSearch}
        productCardLoading={productCardLoading}
        productCardError={productCardError}
        productCardSaving={productCardSaving}
        productCardDeleting={productCardDeleting}
        saveProductCard={saveProductCard}
        deleteProductCard={deleteProductCard}
        openCodebook={openCodebook}
      />
    );
  }

  return (
    <RecountPage
      scanSuccessFlash={scanner.scanSuccessFlash}
      scannerOn={scanner.scannerOn}
      toggleScanner={scanner.toggleScanner}
      torchOn={scanner.torchOn}
      toggleTorch={scanner.toggleTorch}
      videoRef={scanner.videoRef}
      focusScannerCamera={scanner.focusScannerCamera}
      adjustScannerZoom={scanner.adjustScannerZoom}
      scannerZoom={scanner.scannerZoom}
      handleScannerDoubleClick={scanner.handleScannerDoubleClick}
      loading={loading}
      scannerStatus={scanner.scannerStatus}
      progressSummary={progressSummary}
      unresolvedBarcode={unresolvedBarcode}
      candidateCodes={candidateCodes}
      openBindModal={openBindModal}
      bindTargetBarcode={bindTargetBarcode}
      hiddenCompletedMatch={hiddenCompletedMatch}
      search={search}
      setSearch={setSearch}
      error={error}
      itemsFeedRef={itemsFeedRef}
      activeFactCode={activeFactCode}
      filteredItems={filteredItems}
      computeRowState={computeRowState}
      values={values}
      itemCardRefs={itemCardRefs}
      updateFact={updateFact}
      handleFactFocus={handleFactFocus}
      handleFactBlur={handleFactBlur}
      menuOpen={menuOpen}
      setMenuOpen={setMenuOpen}
      handleSaveNow={handleSaveNow}
      mismatchFilter={mismatchFilter}
      setMismatchFilter={setMismatchFilter}
      mismatchModalOpen={mismatchModalOpen}
      setMismatchModalOpen={setMismatchModalOpen}
      hideCompletedItems={hideCompletedItems}
      setHideCompletedItems={setHideCompletedItems}
      mismatchItems={mismatchItems}
      openCompleteModal={openCompleteModal}
      handleFinishWithoutPdf={handleFinishWithoutPdf}
      goHome={goHome}
      deleteActiveRecount={deleteActiveRecount}
      deletingRecountId={deletingRecountId}
      activeRecount={activeRecount}
      keypadRef={keypadRef}
      appendToActiveFact={appendToActiveFact}
      eraseActiveFact={eraseActiveFact}
      keepFactKeypadOpen={keepFactKeypadOpen}
      completeModalOpen={completeModalOpen}
      setCompleteModalOpen={setCompleteModalOpen}
      counterName={counterName}
      setCounterName={setCounterName}
      groupName={groupName}
      setGroupName={setGroupName}
      includeTotalSummary={includeTotalSummary}
      setIncludeTotalSummary={setIncludeTotalSummary}
      includeDiscrepancyTable={includeDiscrepancyTable}
      setIncludeDiscrepancyTable={setIncludeDiscrepancyTable}
      updateCompletionTime={updateCompletionTime}
      setUpdateCompletionTime={setUpdateCompletionTime}
      handleCompleteRecount={handleCompleteRecount}
      bindModalOpen={bindModalOpen}
      closeBindModal={closeBindModal}
      candidateItems={candidateItems}
      bindBarcodeToSelectedItem={bindBarcodeToSelectedItem}
      bindSearch={bindSearch}
      setBindSearch={setBindSearch}
      bindFilteredItems={bindFilteredItems}
    />
  );
}
