import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  BarChart3,
  Bell,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock3,
  Download,
  FileCheck2,
  FileText,
  Gauge,
  Grid2X2,
  History,
  LayoutDashboard,
  Loader2,
  LockKeyhole,
  Menu,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  UploadCloud,
  UserRound,
  X,
  Zap,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';

type Screen = 'dashboard' | 'screening' | 'cases' | 'caseDetail' | 'reports' | 'settings';
type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
type CaseStatus = 'CLEARED' | 'MANUAL REVIEW' | 'FLAGGED';
type CaseItem = {
  id?: string;
  case_id: string;
  document_name: string;
  document_type: string;
  risk_score: number;
  risk_level: RiskLevel;
  status: CaseStatus;
  signals: Signal[];
  created_at: string;
};
type Signal = { label: string; detail: string; score: number; tone: 'good' | 'warn' | 'bad' };

const DOCUMENT_TYPES = [
  { type: 'Passport', file: 'passport_scan_demo.pdf', icon: 'passport' },
  { type: 'Driver license', file: 'drivers_license_front.jpg', icon: 'license' },
  { type: 'Residence permit', file: 'residence_permit.png', icon: 'permit' },
  { type: 'National ID', file: 'national_id_card.jpg', icon: 'idcard' },
  { type: 'Utility bill', file: 'utility_bill_proof.pdf', icon: 'bill' },
];

const SIGNAL_POOL: Record<string, Signal[]> = {
  Passport: [
    { label: 'OCR extraction', detail: 'Inconsistency detected in machine-readable zone', score: 20, tone: 'warn' },
    { label: 'Document format', detail: 'Layout differs from known passport templates', score: 5, tone: 'warn' },
    { label: 'Tampering markers', detail: 'Suspicious signal around portrait layer', score: 30, tone: 'bad' },
    { label: 'Face verification', detail: 'Low confidence match against submitted selfie', score: 25, tone: 'bad' },
  ],
  'Driver license': [
    { label: 'OCR extraction', detail: 'All fields extracted with high confidence', score: 0, tone: 'good' },
    { label: 'Hologram check', detail: 'Security hologram pattern verified', score: 0, tone: 'good' },
    { label: 'Face verification', detail: 'Strong match with submitted selfie', score: 2, tone: 'good' },
    { label: 'Barcode validation', detail: 'PDF417 barcode data consistent with OCR fields', score: 0, tone: 'good' },
  ],
  'Residence permit': [
    { label: 'OCR extraction', detail: 'Minor field inconsistency in expiry date', score: 10, tone: 'warn' },
    { label: 'Document format', detail: 'Template matches known residence permits', score: 0, tone: 'good' },
    { label: 'Watermark check', detail: 'Watermark partially degraded — possible scan artifact', score: 15, tone: 'warn' },
    { label: 'Face verification', detail: 'Moderate match confidence', score: 12, tone: 'warn' },
  ],
  'National ID': [
    { label: 'OCR extraction', detail: 'All fields extracted successfully', score: 0, tone: 'good' },
    { label: 'Chip verification', detail: 'NFC chip data consistent with printed fields', score: 0, tone: 'good' },
    { label: 'Face verification', detail: 'High confidence match', score: 1, tone: 'good' },
    { label: 'Tampering markers', detail: 'No tampering signals detected', score: 0, tone: 'good' },
  ],
  'Utility bill': [
    { label: 'OCR extraction', detail: 'Address fields extracted with high confidence', score: 0, tone: 'good' },
    { label: 'Date validation', detail: 'Issue date within acceptable range', score: 0, tone: 'good' },
    { label: 'Address match', detail: 'Address matches user profile', score: 0, tone: 'good' },
    { label: 'Tampering markers', detail: 'No editing artifacts detected', score: 0, tone: 'good' },
  ],
};

const PIPELINE_STEPS = ['Document upload', 'OCR extraction', 'Field validation', 'Tampering detection', 'Face verification', 'Risk calculation'];

const navItems: { id: Screen; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
  { id: 'screening', label: 'New screening', icon: Plus },
  { id: 'cases', label: 'Case history', icon: History },
  { id: 'reports', label: 'Reports', icon: BarChart3 },
];

function generateCaseId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const suffix = Array.from({ length: 2 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `CASE-${Date.now().toString().slice(-4)}-${suffix}`;
}

function computeRisk(signals: Signal[]): { score: number; level: RiskLevel; status: CaseStatus } {
  const score = Math.min(100, signals.reduce((sum, s) => sum + s.score, 0));
  let level: RiskLevel = 'LOW';
  let status: CaseStatus = 'CLEARED';
  if (score >= 50) { level = 'HIGH'; status = 'MANUAL REVIEW'; }
  else if (score >= 15) { level = 'MEDIUM'; status = 'MANUAL REVIEW'; }
  return { score, level, status };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
function formatRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return formatDate(iso);
}

function App() {
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [cases, setCases] = useState<CaseItem[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);

  const loadCases = useCallback(async () => {
    const { data } = await supabase
      .from('docshield_cases')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (data) {
      setCases(
        data.map((row: Record<string, unknown>) => ({
          ...row,
          signals: Array.isArray(row.signals) ? row.signals : [],
        })) as CaseItem[]
      );
    }
  }, []);

  useEffect(() => {
    void loadCases();
  }, [loadCases]);

  function navigate(target: Screen) {
    setScreen(target);
    setIsSidebarOpen(false);
    if (target !== 'caseDetail') setSelectedCaseId(null);
  }

  function openCaseDetail(caseId: string) {
    setSelectedCaseId(caseId);
    setScreen('caseDetail');
  }

  function handleCaseUpdated(updated: CaseItem) {
    setCases((current) => current.map((c) => (c.case_id === updated.case_id ? updated : c)));
  }

  const selectedCase = useMemo(
    () => cases.find((c) => c.case_id === selectedCaseId) ?? null,
    [cases, selectedCaseId]
  );

  return (
    <div className="app-shell">
      <aside className={`sidebar ${isSidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="brand-lockup">
          <div className="brand-mark"><ShieldCheck size={19} strokeWidth={2.4} /></div>
          <div><strong>DocShield</strong><span>AI security console</span></div>
        </div>
        <div className="workspace-label">Workspace <span>PROTOTYPE</span></div>
        <nav className="nav-list">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${screen === id || (id === 'cases' && screen === 'caseDetail') ? 'active' : ''}`}
              onClick={() => navigate(id)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {id === 'screening' && <kbd>⌘ K</kbd>}
            </button>
          ))}
        </nav>
        <div className="sidebar-divider" />
        <button
          className={`nav-item ${screen === 'settings' ? 'active' : ''}`}
          onClick={() => navigate('settings')}
        >
          <Settings size={18} /><span>Settings</span>
        </button>
        <div className="sidebar-bottom">
          <div className="security-card">
            <div className="live-dot" />
            <div><strong>Systems operational</strong><span>All screening services online</span></div>
          </div>
          <div className="profile">
            <div className="avatar">JD</div>
            <div><strong>Jordan Davis</strong><span>Security analyst</span></div>
            <MoreHorizontal size={18} />
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setIsSidebarOpen((v) => !v)}>
            <Menu size={20} />
          </button>
          <div className="breadcrumbs">
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>
              {screen === 'caseDetail'
                ? 'Case detail'
                : navItems.find((item) => item.id === screen)?.label ?? 'Settings'}
            </strong>
          </div>
          <div className="top-actions">
            <div className="prototype-badge"><span /> Prototype mode</div>
            <button className="icon-button"><Bell size={18} /><i /></button>
            <button className="help-button"><CircleHelp size={17} /> Help center</button>
          </div>
        </header>

        {screen === 'dashboard' && (
          <Dashboard cases={cases} onNew={() => navigate('screening')} onCases={() => navigate('cases')} onCaseClick={openCaseDetail} />
        )}
        {screen === 'screening' && (
          <Screening
            onBack={() => navigate('dashboard')}
            onCases={() => navigate('cases')}
            onCaseCreated={(newCase) => {
              setCases((current) => [newCase, ...current.filter((c) => c.case_id !== newCase.case_id)]);
            }}
          />
        )}
        {screen === 'cases' && (
          <Cases
            cases={cases}
            onNew={() => navigate('screening')}
            onCaseClick={openCaseDetail}
          />
        )}
        {screen === 'caseDetail' && selectedCase && (
          <CaseDetail
            caseItem={selectedCase}
            onBack={() => navigate('cases')}
            onUpdated={handleCaseUpdated}
          />
        )}
        {screen === 'caseDetail' && !selectedCase && (
          <div className="page-body">
            <p className="empty-text">Case not found. <button className="text-button" onClick={() => navigate('cases')}>Back to cases</button></p>
          </div>
        )}
        {screen === 'reports' && <Reports cases={cases} />}
        {screen === 'settings' && <SettingsView />}
      </main>
    </div>
  );
}

/* ============ Dashboard ============ */

function Dashboard({ cases, onNew, onCases, onCaseClick }: {
  cases: CaseItem[];
  onNew: () => void;
  onCases: () => void;
  onCaseClick: (id: string) => void;
}) {
  const total = cases.length;
  const flagged = cases.filter((c) => c.risk_level === 'HIGH').length;
  const avgRisk = total > 0 ? (cases.reduce((sum, c) => sum + c.risk_score, 0) / total).toFixed(1) : '0';
  const lowCount = cases.filter((c) => c.risk_level === 'LOW').length;
  const medCount = cases.filter((c) => c.risk_level === 'MEDIUM').length;
  const highCount = cases.filter((c) => c.risk_level === 'HIGH').length;
  const lowPct = total > 0 ? ((lowCount / total) * 100).toFixed(1) : '0';
  const medPct = total > 0 ? ((medCount / total) * 100).toFixed(1) : '0';
  const highPct = total > 0 ? ((highCount / total) * 100).toFixed(1) : '0';
  const reviewCount = cases.filter((c) => c.status === 'MANUAL REVIEW').length;
  const clearedPct = total > 0 ? ((cases.filter((c) => c.status === 'CLEARED').length / total) * 100).toFixed(1) : '0';

  return (
    <div className="page-body">
      <PageHeader
        eyebrow={new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        title="Good morning, Jordan."
        description="Here's what's happening across your document security workspace."
        action={<button className="primary-button" onClick={onNew}><Plus size={18} /> New screening</button>}
      />
      <div className="prototype-strip">
        <div className="strip-icon"><Zap size={17} /></div>
        <div>
          <strong>Prototype environment</strong>
          <span>Deterministic mock services are active. No external APIs or real identity data are used in this workspace.</span>
        </div>
      </div>

      <section className="stats-grid">
        <StatCard icon={FileCheck2} label="Documents screened" value={total.toString()} note="total screenings" tone="blue" />
        <StatCard icon={AlertTriangle} label="Flagged for review" value={flagged.toString()} note="high-risk documents" tone="red" />
        <StatCard icon={Gauge} label="Average risk score" value={avgRisk} note="across all cases" tone="green" />
        <StatCard icon={Clock3} label="Pending review" value={reviewCount.toString()} note="awaiting analyst" tone="amber" />
      </section>

      <div className="dashboard-grid">
        <section className="panel chart-panel">
          <div className="panel-heading">
            <div><h2>Recent screenings</h2><span>Latest 12 cases</span></div>
          </div>
          <div className="mini-chart">
            {cases.slice(0, 12).reverse().map((c) => (
              <div key={c.case_id} className="mini-bar" title={`${c.case_id}: ${c.risk_score}`}>
                <div
                  className={`mini-bar-fill ${c.risk_level.toLowerCase()}`}
                  style={{ height: `${Math.max(4, c.risk_score)}%` }}
                />
              </div>
            ))}
            {cases.length === 0 && <div className="mini-chart-empty">No screenings yet</div>}
          </div>
        </section>

        <section className="panel distribution-panel">
          <div className="panel-heading">
            <div><h2>Risk distribution</h2><span>All screened documents</span></div>
          </div>
          <div className="donut-wrap">
            <div className="donut" style={{
              background: `conic-gradient(
                var(--green) 0deg ${total > 0 ? (lowCount / total) * 360 : 0}deg,
                var(--amber) ${total > 0 ? (lowCount / total) * 360 : 0}deg ${total > 0 ? ((lowCount + medCount) / total) * 360 : 0}deg,
                var(--red) ${total > 0 ? ((lowCount + medCount) / total) * 360 : 0}deg 360deg
              )`,
            }}>
              <div><strong>{total}</strong><span>total</span></div>
            </div>
            <div className="distribution-list">
              <RiskRow color="green" label="Low risk" value={lowCount.toString()} percent={`${lowPct}%`} />
              <RiskRow color="amber" label="Medium risk" value={medCount.toString()} percent={`${medPct}%`} />
              <RiskRow color="red" label="High risk" value={highCount.toString()} percent={`${highPct}%`} />
            </div>
          </div>
          <button className="text-button" onClick={onCases}>View all cases <ArrowUpRight size={15} /></button>
        </section>
      </div>

      <div className="section-heading">
        <div><h2>Recent screenings</h2><span>Latest activity from your workspace</span></div>
        <button className="text-button" onClick={onCases}>View all <ArrowUpRight size={15} /></button>
      </div>
      <section className="panel table-panel">
        {cases.length > 0 ? (
          <table>
            <thead>
              <tr><th>Case ID</th><th>Document</th><th>Type</th><th>Risk score</th><th>Status</th><th>Screened</th><th /></tr>
            </thead>
            <tbody>
              {cases.slice(0, 5).map((item) => (
                <CaseRow key={item.case_id} item={item} onClick={() => onCaseClick(item.case_id)} />
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState
            icon={FileText}
            title="No screenings yet"
            subtitle="Run your first document screening to see results here."
            action={<button className="primary-button" onClick={onNew}><Plus size={18} /> New screening</button>}
          />
        )}
      </section>
      <div className="system-note"><LockKeyhole size={15} /> Data is encrypted at rest and in transit. Prototype data is automatically purged after 30 days.</div>
    </div>
  );
}

/* ============ Screening ============ */

function Screening({ onBack, onCases, onCaseCreated }: {
  onBack: () => void;
  onCases: () => void;
  onCaseCreated: (c: CaseItem) => void;
}) {
  const [selectedDoc, setSelectedDoc] = useState(DOCUMENT_TYPES[0]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentStep, setCurrentStep] = useState(-1);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<CaseItem | null>(null);
  const [draftId] = useState(() => generateCaseId());

  function chooseDoc(doc: typeof DOCUMENT_TYPES[0]) {
    setSelectedDoc(doc);
    setIsLoaded(true);
    setResult(null);
  }

  function resetDoc() {
    setSelectedDoc(DOCUMENT_TYPES[0]);
    setIsLoaded(false);
    setResult(null);
    setCurrentStep(-1);
    setProgress(0);
  }

  async function runScreening() {
    if (!isLoaded || isProcessing) return;
    setIsProcessing(true);
    setResult(null);
    setProgress(0);

    for (let i = 0; i < PIPELINE_STEPS.length; i++) {
      setCurrentStep(i);
      await new Promise((r) => setTimeout(r, 450));
      setProgress(Math.round(((i + 1) / PIPELINE_STEPS.length) * 100));
    }

    const signals = SIGNAL_POOL[selectedDoc.type];
    const { score, level, status } = computeRisk(signals);
    const newCase: CaseItem = {
      case_id: draftId,
      document_name: selectedDoc.file,
      document_type: selectedDoc.type,
      risk_score: score,
      risk_level: level,
      status,
      signals,
      created_at: new Date().toISOString(),
    };

    const { data } = await supabase.from('docshield_cases').upsert(newCase, { onConflict: 'case_id' }).select().single();
    if (data) {
      const saved = { ...newCase, id: data.id as string };
      onCaseCreated(saved);
      setResult(saved);
    } else {
      onCaseCreated(newCase);
      setResult(newCase);
    }

    setCurrentStep(-1);
    setIsProcessing(false);
  }

  return (
    <div className="page-body screening-page">
      <PageHeader
        eyebrow="SCREENING WORKFLOW / NEW CASE"
        title="Screen a document"
        description="Upload a document to run the DocShield AI security pipeline."
        action={<div className="case-draft"><span>Draft case</span><strong>{draftId}</strong></div>}
      />
      <div className="workflow-layout">
        <section className="workflow-main">
          <div className="stepper">
            {PIPELINE_STEPS.map((step, index) => {
              const isComplete = isProcessing && index < currentStep;
              const isActive = isProcessing && index === currentStep;
              const isDone = result !== null;
              return (
                <div
                  key={step}
                  className={`step ${isActive ? 'active' : ''} ${isComplete || isDone ? 'complete' : ''}`}
                >
                  <span>
                    {isComplete || isDone ? <Check size={13} /> : isActive ? <Loader2 size={12} className="spin" /> : index + 1}
                  </span>
                  <label>{step}</label>
                </div>
              );
            })}
          </div>

          {isProcessing && (
            <div className="progress-bar-container">
              <div className="progress-bar-track">
                <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
              </div>
              <span>{progress}%</span>
            </div>
          )}

          <div className={`upload-card ${isLoaded ? 'loaded' : ''}`}>
            {!isLoaded ? (
              <>
                <div className="upload-icon"><UploadCloud size={27} /></div>
                <h2>Choose a demo document</h2>
                <p>Select one of the sample documents below to run through the screening pipeline.</p>
                <div className="doc-picker">
                  {DOCUMENT_TYPES.map((doc) => (
                    <button key={doc.type} className="doc-option" onClick={() => chooseDoc(doc)}>
                      <FileText size={18} />
                      <div>
                        <strong>{doc.type}</strong>
                        <span>{doc.file}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            ) : result ? (
              <>
                <div className="upload-icon result-icon"><ShieldCheck size={27} /></div>
                <h2>Screening complete</h2>
                <p>{result.document_name} has been analyzed.</p>
                <div className="result-inline">
                  <div className={`result-score-badge ${result.risk_level.toLowerCase()}`}>
                    <strong>{result.risk_score}</strong>
                    <span>{result.risk_level} RISK</span>
                  </div>
                  <div className="result-inline-info">
                    <strong>{result.status === 'CLEARED' ? 'Document cleared' : 'Manual review required'}</strong>
                    <span>{result.signals.length} signals detected</span>
                  </div>
                </div>
                <div className="screening-controls">
                  <button className="ghost-button" onClick={resetDoc}><X size={16} /> Screen another</button>
                  <button className="primary-button" onClick={onCases}><History size={16} /> View in cases</button>
                </div>
              </>
            ) : (
              <>
                <div className="upload-icon"><FileCheck2 size={27} /></div>
                <h2>Document loaded</h2>
                <p>{selectedDoc.file} is ready for screening.</p>
                <div className="loaded-file">
                  <FileText size={16} />
                  <span>{selectedDoc.file}</span>
                  <button className="file-remove" onClick={resetDoc}><X size={14} /></button>
                </div>
                <div className="screening-controls" style={{ marginTop: '16px' }}>
                  <button className="ghost-button" onClick={resetDoc}><X size={16} /> Change document</button>
                  <button className="primary-button" disabled={isProcessing} onClick={runScreening}>
                    {isProcessing ? <><Activity size={17} className="spin" /> Running checks…</> : <><ShieldCheck size={17} /> Run AI screening</>}
                  </button>
                </div>
              </>
            )}
          </div>

          {!isLoaded && (
            <div className="screening-controls">
              <button className="ghost-button" onClick={onBack}><ArrowLeft size={16} /> Back to overview</button>
            </div>
          )}
        </section>

        <aside className="workflow-aside">
          <div className="aside-heading"><ShieldCheck size={18} /><strong>Pipeline checks</strong></div>
          <p>Every document passes through six explainable checks before a risk score is generated.</p>
          <div className="check-list">
            {PIPELINE_STEPS.map((step) => (
              <div key={step} className={isProcessing && currentStep >= PIPELINE_STEPS.indexOf(step) ? 'check-done' : ''}>
                {isProcessing && currentStep >= PIPELINE_STEPS.indexOf(step) ? <CheckCircle2 size={15} /> : <Check size={15} />}
                {step}
              </div>
            ))}
          </div>
          <div className="privacy-callout">
            <LockKeyhole size={15} />
            <span><strong>Privacy first</strong> Demo documents never leave this prototype environment.</span>
          </div>
        </aside>
      </div>
    </div>
  );
}

/* ============ Cases ============ */

function Cases({ cases, onNew, onCaseClick }: {
  cases: CaseItem[];
  onNew: () => void;
  onCaseClick: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'ALL' | RiskLevel>('ALL');

  const counts = useMemo(() => ({
    ALL: cases.length,
    HIGH: cases.filter((c) => c.risk_level === 'HIGH').length,
    MEDIUM: cases.filter((c) => c.risk_level === 'MEDIUM').length,
    LOW: cases.filter((c) => c.risk_level === 'LOW').length,
  }), [cases]);

  const filtered = useMemo(() => cases.filter((item) => {
    const matchesSearch = `${item.case_id} ${item.document_name} ${item.document_type}`.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === 'ALL' || item.risk_level === filter;
    return matchesSearch && matchesFilter;
  }), [cases, filter, search]);

  function exportCsv() {
    const headers = ['Case ID', 'Document', 'Type', 'Risk Score', 'Risk Level', 'Status', 'Screened'];
    const rows = filtered.map((c) => [c.case_id, c.document_name, c.document_type, c.risk_score, c.risk_level, c.status, c.created_at]);
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'docshield_cases.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="page-body">
      <PageHeader
        eyebrow="CASE MANAGEMENT"
        title="Case history"
        description="Review, filter, and export screening activity across your workspace."
        action={<button className="primary-button" onClick={onNew}><Plus size={18} /> New screening</button>}
      />
      <div className="toolbar">
        <div className="search-field">
          <Search size={17} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search case ID or document…" />
        </div>
        <div className="filter-tabs">
          {(['ALL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((f) => (
            <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
              {f === 'ALL' ? 'All' : f === 'HIGH' ? 'High risk' : f === 'MEDIUM' ? 'Medium' : 'Low'}
              <span>{counts[f]}</span>
            </button>
          ))}
        </div>
        <button className="secondary-button compact" onClick={exportCsv}><Download size={15} /> Export CSV</button>
      </div>

      <section className="panel table-panel case-table">
        {filtered.length > 0 ? (
          <table>
            <thead>
              <tr><th>Case ID</th><th>Document</th><th>Type</th><th>Risk score</th><th>Status</th><th>Screened</th><th /></tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <CaseRow key={item.case_id} item={item} onClick={() => onCaseClick(item.case_id)} />
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState
            icon={Search}
            title={search || filter !== 'ALL' ? 'No cases found' : 'No cases yet'}
            subtitle={search || filter !== 'ALL' ? 'Try a different search or filter.' : 'Run your first screening to see cases here.'}
            action={search || filter !== 'ALL' ? undefined : <button className="primary-button" onClick={onNew}><Plus size={18} /> New screening</button>}
          />
        )}
      </section>
      {filtered.length > 0 && (
        <div className="table-footer">
          <span>Showing {filtered.length} of {cases.length} cases</span>
        </div>
      )}
    </div>
  );
}

/* ============ Case Detail ============ */

function CaseDetail({ caseItem, onBack, onUpdated }: {
  caseItem: CaseItem;
  onBack: () => void;
  onUpdated: (c: CaseItem) => void;
}) {
  const [status, setStatus] = useState<CaseStatus>(caseItem.status);
  const [isUpdating, setIsUpdating] = useState(false);

  async function updateStatus(newStatus: CaseStatus) {
    if (newStatus === status || isUpdating) return;
    setIsUpdating(true);
    const updated = { ...caseItem, status: newStatus };
    const { error } = await supabase.from('docshield_cases').update({ status: newStatus }).eq('case_id', caseItem.case_id);
    if (!error) {
      setStatus(newStatus);
      onUpdated(updated);
    }
    setIsUpdating(false);
  }

  return (
    <div className="page-body">
      <button className="ghost-button back-link" onClick={onBack}><ArrowLeft size={16} /> Back to cases</button>
      <div className="case-detail-header">
        <div>
          <div className="eyebrow">{caseItem.case_id}</div>
          <h1>{caseItem.document_name}</h1>
          <p>{caseItem.document_type} · Screened {formatRelative(caseItem.created_at)}</p>
        </div>
        <div className={`case-detail-status ${status === 'CLEARED' ? 'cleared' : 'review'}`}>
          {status === 'CLEARED' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          {status}
        </div>
      </div>

      <div className="case-detail-grid">
        <div className="case-detail-main">
          <section className="panel">
            <div className="panel-heading"><div><h2>Risk assessment</h2><span>AI-generated score and recommendation</span></div></div>
            <div className="risk-assessment">
              <div className={`risk-score-display ${caseItem.risk_level.toLowerCase()}`}>
                <strong>{caseItem.risk_score}</strong>
                <span>{caseItem.risk_level} RISK</span>
              </div>
              <div className="risk-assessment-info">
                <strong>{caseItem.status === 'CLEARED' ? 'Document cleared automatically' : 'Manual review recommended'}</strong>
                <span>
                  {caseItem.risk_score < 15
                    ? 'All checks passed with minimal risk signals. Document is safe to approve.'
                    : caseItem.risk_score < 50
                      ? 'Some checks raised minor concerns. An analyst should review before approval.'
                      : 'Multiple high-risk signals detected. This document requires immediate analyst attention.'}
                </span>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading"><div><h2>Explainable signals</h2><span>{caseItem.signals.length} checks performed</span></div></div>
            <div className="signals-list">
              {caseItem.signals.map((signal) => (
                <div className="signal-row" key={signal.label}>
                  <div className={`signal-icon ${signal.tone}`}>
                    {signal.tone === 'good' ? <Check size={15} /> : <AlertTriangle size={15} />}
                  </div>
                  <div>
                    <strong>{signal.label}</strong>
                    <span>{signal.detail}</span>
                  </div>
                  <b className={signal.score > 0 ? 'penalty' : 'neutral'}>{signal.score > 0 ? `+${signal.score}` : '0'}</b>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="case-detail-aside">
          <section className="panel">
            <div className="panel-heading"><div><h2>Case metadata</h2></div></div>
            <div className="meta-list">
              <div><span>Case ID</span><strong className="case-id">{caseItem.case_id}</strong></div>
              <div><span>Document</span><strong>{caseItem.document_name}</strong></div>
              <div><span>Document type</span><strong>{caseItem.document_type}</strong></div>
              <div><span>Risk score</span><strong>{caseItem.risk_score}/100</strong></div>
              <div><span>Risk level</span><strong>{caseItem.risk_level}</strong></div>
              <div><span>Screened</span><strong>{formatDate(caseItem.created_at)} at {formatTime(caseItem.created_at)}</strong></div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading"><div><h2>Analyst actions</h2></div></div>
            <div className="action-list">
              <button
                className={`action-button ${status === 'CLEARED' ? 'active' : ''}`}
                disabled={isUpdating || status === 'CLEARED'}
                onClick={() => updateStatus('CLEARED')}
              >
                <CheckCircle2 size={18} />
                <div><strong>Clear case</strong><span>Mark as verified and approved</span></div>
                {status === 'CLEARED' && <Check size={16} />}
              </button>
              <button
                className={`action-button ${status === 'FLAGGED' ? 'active flagged' : ''}`}
                disabled={isUpdating || status === 'FLAGGED'}
                onClick={() => updateStatus('FLAGGED')}
              >
                <AlertTriangle size={18} />
                <div><strong>Flag as fraudulent</strong><span>Escalate for investigation</span></div>
                {status === 'FLAGGED' && <Check size={16} />}
              </button>
              <button
                className={`action-button ${status === 'MANUAL REVIEW' ? 'active' : ''}`}
                disabled={isUpdating || status === 'MANUAL REVIEW'}
                onClick={() => updateStatus('MANUAL REVIEW')}
              >
                <Clock3 size={18} />
                <div><strong>Send to review</strong><span>Return to manual review queue</span></div>
                {status === 'MANUAL REVIEW' && <Check size={16} />}
              </button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

/* ============ Reports ============ */

function Reports({ cases }: { cases: CaseItem[] }) {
  const total = cases.length;
  const cleared = cases.filter((c) => c.status === 'CLEARED').length;
  const review = cases.filter((c) => c.status === 'MANUAL REVIEW').length;
  const flagged = cases.filter((c) => c.status === 'FLAGGED').length;
  const avgRisk = total > 0 ? (cases.reduce((sum, c) => sum + c.risk_score, 0) / total).toFixed(1) : '0';
  const clearedPct = total > 0 ? ((cleared / total) * 100).toFixed(1) : '0';
  const accuracy = total > 0 ? (((cleared + flagged) / total) * 100).toFixed(1) : '0';

  function exportReport() {
    const lines = [
      'DocShield AI — Screening Report',
      `Generated: ${new Date().toLocaleString()}`,
      '',
      `Total screenings: ${total}`,
      `Cleared: ${cleared} (${clearedPct}%)`,
      `Manual review: ${review}`,
      `Flagged: ${flagged}`,
      `Average risk score: ${avgRisk}`,
      `Screening accuracy: ${accuracy}%`,
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'docshield_report.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="page-body">
      <PageHeader
        eyebrow="ANALYTICS & EXPORTS"
        title="Reports"
        description="Understand your workspace risk patterns and screening throughput."
        action={<button className="secondary-button" onClick={exportReport}><Download size={16} /> Export report</button>}
      />
      <div className="report-hero">
        <div>
          <div className="eyebrow light">WORKSPACE OVERVIEW</div>
          <h2>{total === 0 ? 'No data yet — run a screening to see insights.' : 'Risk is trending in the right direction.'}</h2>
          {total > 0 && <p>Screening volume is {total} documents with an average risk score of {avgRisk}.</p>}
        </div>
        <div className="report-score">
          <span>Avg. risk score</span>
          <strong>{avgRisk}</strong>
        </div>
      </div>
      <div className="report-grid">
        <div className="panel report-card">
          <span className="report-icon blue"><Activity size={18} /></span>
          <span>Screening accuracy</span>
          <strong>{accuracy}%</strong>
          <small>Based on {total} resolved cases</small>
        </div>
        <div className="panel report-card">
          <span className="report-icon green"><ShieldCheck size={18} /></span>
          <span>Auto-clear rate</span>
          <strong>{clearedPct}%</strong>
          <small>{cleared} documents cleared</small>
        </div>
        <div className="panel report-card">
          <span className="report-icon amber"><UserRound size={18} /></span>
          <span>Human review handoffs</span>
          <strong>{review + flagged}</strong>
          <small>Requires analyst attention</small>
        </div>
      </div>
    </div>
  );
}

/* ============ Settings ============ */

function SettingsView() {
  const [activeTab, setActiveTab] = useState('general');
  const [mockServices, setMockServices] = useState(true);
  const [autoPurge, setAutoPurge] = useState(true);
  const [notifications, setNotifications] = useState(true);
  const [saved, setSaved] = useState(false);

  const tabs = [
    { id: 'general', label: 'General', icon: Grid2X2 },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'privacy', label: 'Privacy & security', icon: LockKeyhole },
    { id: 'team', label: 'Team access', icon: UserRound },
  ];

  function save() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="page-body">
      <PageHeader eyebrow="WORKSPACE CONFIGURATION" title="Settings" description="Configure the way your security team works with DocShield AI." />
      <div className="settings-layout">
        <div className="settings-nav">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={activeTab === tab.id ? 'active' : ''}
              onClick={() => setActiveTab(tab.id)}
            >
              <tab.icon size={17} /> {tab.label}
            </button>
          ))}
        </div>
        <section className="panel settings-panel">
          {activeTab === 'general' && (
            <>
              <div className="settings-section">
                <div><h2>Workspace profile</h2><p>Basic information shown across your screening workspace.</p></div>
                <div className="settings-fields">
                  <label>Workspace name<input defaultValue="DocShield AI — Demo Workspace" /></label>
                  <label>Time zone<select defaultValue="Pacific Time"><option>Pacific Time</option><option>Eastern Time</option><option>UTC</option></select></label>
                </div>
              </div>
              <div className="settings-section">
                <div><h2>Prototype controls</h2><p>These settings help you demonstrate the screening workflow safely.</p></div>
                <div className="settings-toggles">
                  <div className="toggle-row">
                    <div><strong>Mock services</strong><span>Use deterministic results without external APIs</span></div>
                    <div className={`toggle ${mockServices ? 'on' : ''}`} onClick={() => setMockServices(!mockServices)}><i /></div>
                  </div>
                  <div className="toggle-row">
                    <div><strong>Auto-purge demo data</strong><span>Remove prototype cases after 30 days</span></div>
                    <div className={`toggle ${autoPurge ? 'on' : ''}`} onClick={() => setAutoPurge(!autoPurge)}><i /></div>
                  </div>
                </div>
              </div>
            </>
          )}
          {activeTab === 'notifications' && (
            <div className="settings-section">
              <div><h2>Notification preferences</h2><p>Choose when DocShield should alert your team.</p></div>
              <div className="settings-toggles">
                <div className="toggle-row">
                  <div><strong>Email alerts</strong><span>Receive notifications when cases are flagged</span></div>
                  <div className={`toggle ${notifications ? 'on' : ''}`} onClick={() => setNotifications(!notifications)}><i /></div>
                </div>
                <div className="toggle-row">
                  <div><strong>Daily digest</strong><span>Summary of all screenings sent each morning</span></div>
                  <div className="toggle on"><i /></div>
                </div>
              </div>
            </div>
          )}
          {activeTab === 'privacy' && (
            <div className="settings-section">
              <div><h2>Privacy & security</h2><p>Controls for how screening data is handled and retained.</p></div>
              <div className="settings-toggles">
                <div className="toggle-row">
                  <div><strong>Encrypt at rest</strong><span>All screening data is encrypted in the database</span></div>
                  <div className="toggle on"><i /></div>
                </div>
                <div className="toggle-row">
                  <div><strong>Auto-purge demo data</strong><span>Remove prototype cases after 30 days</span></div>
                  <div className={`toggle ${autoPurge ? 'on' : ''}`} onClick={() => setAutoPurge(!autoPurge)}><i /></div>
                </div>
              </div>
            </div>
          )}
          {activeTab === 'team' && (
            <div className="settings-section">
              <div><h2>Team access</h2><p>Manage who can access this workspace.</p></div>
              <div className="team-list">
                <div className="team-member"><div className="avatar">JD</div><div><strong>Jordan Davis</strong><span>Security analyst · Owner</span></div></div>
                <div className="team-member"><div className="avatar">MK</div><div><strong>Maya Kim</strong><span>Compliance reviewer</span></div></div>
                <div className="team-member"><div className="avatar">RS</div><div><strong>Raj Singh</strong><span>Security analyst</span></div></div>
              </div>
            </div>
          )}
          <div className="settings-footer">
            <span>{saved ? 'Saved successfully' : 'Last saved just now'}</span>
            <button className="primary-button" onClick={save}>{saved ? <><Check size={16} /> Saved</> : 'Save changes'}</button>
          </div>
        </section>
      </div>
    </div>
  );
}

/* ============ Shared components ============ */

function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, note, tone }: { icon: typeof FileCheck2; label: string; value: string; note: string; tone: string }) {
  return (
    <div className="stat-card">
      <div className={`stat-icon ${tone}`}><Icon size={19} /></div>
      <span className="stat-label">{label}</span>
      <strong>{value}</strong>
      <div className="stat-foot"><span>{note}</span></div>
    </div>
  );
}

function RiskRow({ color, label, value, percent }: { color: string; label: string; value: string; percent: string }) {
  return (
    <div className="risk-row">
      <span><i className={`risk-dot ${color}`} />{label}</span>
      <strong>{value} <small>{percent}</small></strong>
    </div>
  );
}

function CaseRow({ item, onClick }: { item: CaseItem; onClick: () => void }) {
  return (
    <tr className="clickable-row" onClick={onClick}>
      <td><strong className="case-id">{item.case_id}</strong></td>
      <td>
        <div className="doc-name">
          <span className="file-icon"><FileText size={15} /></span>
          <strong>{item.document_name}</strong>
        </div>
      </td>
      <td>{item.document_type}</td>
      <td><span className={`score-pill ${item.risk_level.toLowerCase()}`}><i />{item.risk_score}</span></td>
      <td><span className={`status-pill ${item.status === 'CLEARED' ? 'cleared' : item.status === 'FLAGGED' ? 'flagged' : 'review'}`}>{item.status}</span></td>
      <td>{formatRelative(item.created_at)}</td>
      <td><ChevronRight size={16} className="row-chevron" /></td>
    </tr>
  );
}

function EmptyState({ icon: Icon, title, subtitle, action }: { icon: typeof FileText; title: string; subtitle: string; action?: React.ReactNode }) {
  return (
    <div className="empty-state">
      <Icon size={28} />
      <strong>{title}</strong>
      <span>{subtitle}</span>
      {action}
    </div>
  );
}

export default App;
