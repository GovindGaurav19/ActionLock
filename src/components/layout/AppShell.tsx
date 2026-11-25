import React, { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import marcusAvatar from '@/assets/images/marcus-vance-avatar.png';
import c4SystemDesign from '@/assets/images/c4-system-design.jpg';
import { useActionLock } from '@/app/providers/ActionLockContext';
import type { ActionCategory } from '@/types/actionlock';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  badge?: string;
  badgeTone?: 'error' | 'muted' | 'teal' | 'emergency';
  isModalTrigger?: boolean;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    mode,
    setMode,
    currentUser,
    demoAccounts,
    dashboardSummary,
    loginDemoAccount,
    logoutBackend,
    envelopes,
    setSelectedEnvelopeId,
    c4SpecOpen,
    setC4SpecOpen,
    newActionModalOpen,
    setNewActionModalOpen,
    commandPaletteOpen,
    setCommandPaletteOpen,
    globalSearch,
    setGlobalSearch,
    toast,
    createProtectedAction,
  } = useActionLock();

  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [orgRegion, setOrgRegion] = useState('US-East');
  const [newActionForm, setNewActionForm] = useState({
    category: 'DevSecOps' as ActionCategory,
    targetTitle: 'GitHub Actions · Production Gateway Release',
    targetSubtitle: 'acme-corp/core-auth-gateway · Run #4902',
    requester: 'alex.chen@acme.corp',
    claimedApprover: 'sarah.jenkins@acme.corp',
    amountOrRepo: 'acme-corp/core-auth-gateway',
  });

  const pendingCount =
    mode === 'live' && dashboardSummary
      ? dashboardSummary.envelopes.activeCount
      : envelopes.filter((e) =>
          ['AWAITING_APPROVER', 'CHALLENGE_ISSUED', 'VOICE_STAGE_PASSED', 'STEP_UP_PENDING', 'PEER_APPROVAL_PENDING'].includes(e.state),
        ).length;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(!commandPaletteOpen);
      }
      if (e.key === 'Escape') {
        setCommandPaletteOpen(false);
        setC4SpecOpen(false);
        setNewActionModalOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [commandPaletteOpen, setC4SpecOpen, setCommandPaletteOpen, setNewActionModalOpen]);

  const navItems: NavItem[] = [
    { to: '/', label: 'Overview', icon: 'dashboard' },
    { to: '/inbox', label: 'Action Inbox', icon: 'inbox', badge: `${pendingCount} pending`, badgeTone: 'error' },
    { to: '#new-action', label: 'New Protected Action', icon: 'add_moderator', isModalTrigger: true },
    { to: '/finance-beneficiary', label: 'Finance Beneficiary Action', icon: 'account_balance' },
    { to: '/approvals', label: 'Approvals & Step-Up', icon: 'verified_user' },
    { to: '/webauthn-permit', label: 'Scoped Permit / WebAuthn', icon: 'key', badge: 'FIDO2', badgeTone: 'teal' },
    { to: '/voice-registry', label: 'Voice Registry', icon: 'record_voice_over' },
    { to: '/security-policies', label: 'Security Policies', icon: 'policy' },
    { to: '/integrations', label: 'Integrations', icon: 'integration_instructions', badge: '3 LIVE', badgeTone: 'muted' },
    { to: '/webhooks', label: 'Webhook Monitor', icon: 'webhook' },
    { to: '/audit-trail', label: 'Audit Trail', icon: 'receipt_long' },
    { to: '/incidents', label: 'Security Incidents', icon: 'gpp_maybe' },
    { to: '/break-glass', label: 'Break-Glass Recovery', icon: 'emergency_home', badge: 'EMERGENCY', badgeTone: 'emergency' },
  ];

  const matchingEnvelopes = envelopes.filter((e) => {
    const q = globalSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      e.id.toLowerCase().includes(q) ||
      e.actionId.toLowerCase().includes(q) ||
      e.targetTitle.toLowerCase().includes(q) ||
      e.actionHash.toLowerCase().includes(q) ||
      e.requester.toLowerCase().includes(q)
    );
  });

  const renderSidebarContent = (collapsedLabels = false) => (
    <div className="flex flex-col h-full">
      {/* Brand header */}
      <div className="p-4 border-b border-[#1E385B] flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <Link to="/" className="flex items-center gap-2 min-w-0" onClick={() => setMobileNavOpen(false)}>
            <svg className="w-7 h-7 shrink-0" viewBox="0 0 32 32" fill="none" aria-label="ACTIONLOCK mark">
              <path
                d="M16 2.5L4.5 7.2V15.4C4.5 22.6 9.4 28.9 16 30.5C22.6 28.9 27.5 22.6 27.5 15.4V7.2L16 2.5Z"
                fill="#172B45"
                stroke="#167C80"
                strokeWidth="2"
              />
              <rect x="11.5" y="14.5" width="9" height="7" rx="1.5" fill="#9AF1F5" />
              <path d="M13 14.5V12.2C13 10.5 14.3 9.2 16 9.2C17.7 9.2 19 10.5 19 12.2V14.5" stroke="#9AF1F5" strokeWidth="1.8" />
            </svg>
            {!collapsedLabels && (
              <span className="font-headline-sm text-[15px] font-semibold tracking-tight text-white truncate">
                ACTIONLOCK
              </span>
            )}
          </Link>
          {!collapsedLabels && (
            <span className="font-mono-badge text-[10px] px-1.5 py-0.5 rounded bg-primary-container text-primary-fixed border border-[#214a65] tracking-wider shrink-0">
              ENTERPRISE
            </span>
          )}
        </div>
        {!collapsedLabels && (
          <button
            type="button"
            onClick={() => setMode(mode === 'demo' ? 'live' : 'demo')}
            className="flex items-center justify-between gap-2 px-2 py-1 rounded bg-[#0d1826] border border-[#1e385b] hover:border-secondary/60 transition-colors w-full text-left"
            title="Toggle Demo Fixtures vs Live Backend Mode"
          >
            <span className="flex items-center gap-1.5">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  mode === 'demo' ? 'bg-status-warning animate-pulse' : 'bg-status-success'
                }`}
              />
              <span className="font-mono-badge text-[10px] text-outline-variant">
                {mode === 'demo' ? 'DEMO ENV · FIXTURES' : 'LIVE MODE · BACKEND'}
              </span>
            </span>
            <span className="font-mono-badge text-[9px] text-secondary-fixed uppercase">{mode}</span>
          </button>
        )}
      </div>

      {/* Nav list */}
      <div className="flex-1 overflow-y-auto py-2 px-2 thin-scrollbar">
        <nav className="flex flex-col gap-0.5" aria-label="Main navigation">
          {navItems.map((item) => {
            if (item.isModalTrigger) {
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => {
                    setNewActionModalOpen(true);
                    setMobileNavOpen(false);
                  }}
                  className="flex items-center justify-between px-3 py-2 rounded text-outline-variant hover:bg-[#1b2f4a] hover:text-white transition-colors group text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="material-symbols-outlined text-[18px] text-text-secondary group-hover:text-white shrink-0">
                      {item.icon}
                    </span>
                    {!collapsedLabels && <span className="font-label-md text-label-md truncate">{item.label}</span>}
                  </div>
                </button>
              );
            }

            const isBreakGlass = item.to === '/break-glass';
            const isActive =
              item.to === '/'
                ? location.pathname === '/'
                : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);

            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setMobileNavOpen(false)}
                className={`flex items-center justify-between px-3 py-2 rounded transition-colors group ${
                  isActive
                    ? 'bg-primary-container text-white border-l-2 border-secondary font-medium'
                    : isBreakGlass
                      ? 'text-error-container hover:bg-[#1b2f4a] border-t border-[#1E385B] mt-2 pt-2.5'
                      : 'text-outline-variant hover:bg-[#1b2f4a] hover:text-white'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`material-symbols-outlined text-[18px] shrink-0 ${
                      isBreakGlass
                        ? 'text-error'
                        : isActive
                          ? 'text-secondary-fixed'
                          : 'text-text-secondary group-hover:text-white'
                    }`}
                  >
                    {item.icon}
                  </span>
                  {!collapsedLabels && <span className="font-label-md text-label-md truncate">{item.label}</span>}
                </div>
                {!collapsedLabels && item.badge && (
                  <span
                    className={`font-mono-badge text-[10px] px-1.5 py-0.5 rounded shrink-0 ${
                      item.badgeTone === 'error'
                        ? 'bg-error/20 text-error-container border border-error/30'
                        : item.badgeTone === 'emergency'
                          ? 'bg-error/25 text-error-container border border-error/40'
                          : item.badgeTone === 'teal'
                            ? 'bg-secondary/20 text-secondary-fixed border border-secondary/40'
                            : 'text-text-secondary opacity-85'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>
      </div>

      {/* Bottom user profile */}
      <div className="p-3 border-t border-[#1E385B] bg-[#0d1826]">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setAccountModalOpen(true)}
            className="flex items-center gap-2 min-w-0 text-left hover:opacity-90"
            title="Switch Demo Identity / Live Backend Session"
          >
            <div className="relative shrink-0">
              <img
                alt={currentUser ? currentUser.displayName : 'Marcus Vance'}
                className="w-8 h-8 rounded-full object-cover border border-[#1e385b]"
                src={marcusAvatar}
              />
              <span
                className={`absolute bottom-0 right-0 h-2 w-2 rounded-full ring-1 ring-[#0d1826] ${
                  mode === 'live' && !currentUser ? 'bg-status-warning' : 'bg-status-success'
                }`}
              />
            </div>
            {!collapsedLabels && (
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-label-md text-label-md font-medium text-white truncate max-w-[96px]">
                    {mode === 'live' ? currentUser?.displayName || 'Sign In Required' : 'Marcus Vance'}
                  </span>
                  <span className="font-mono-badge text-[9px] uppercase px-1 py-0.5 rounded bg-secondary-container text-on-secondary-container font-semibold">
                    {mode === 'live' ? (currentUser ? 'DEMO ACCT' : 'GUEST') : 'Owner'}
                  </span>
                </div>
                <span className="font-body-sm text-[11px] text-text-secondary truncate">
                  {mode === 'live'
                    ? currentUser?.roles?.join(', ') || 'Click to sign in (Demo)'
                    : 'Principal SecOps'}
                </span>
              </div>
            )}
          </button>
          {!collapsedLabels && (
            <button
              type="button"
              onClick={() => setAccountModalOpen(true)}
              className="text-text-secondary hover:text-white transition-colors p-1"
              title="Switch Demo Account Session"
            >
              <span className="material-symbols-outlined text-[18px]">switch_account</span>
            </button>
          )}
        </div>
      </div>
      {accountModalOpen && (
        <div className="fixed inset-0 z-[70] bg-[#14243A]/50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-surface text-on-surface rounded-lg border border-border-subtle shadow-2xl overflow-hidden">
            <div className="px-5 py-3.5 bg-primary-container text-white flex items-center justify-between">
              <div>
                <div className="font-headline-sm">Backend Identity Switcher (DEMO ACCOUNTS)</div>
                <div className="text-[11px] text-primary-fixed-dim">
                  Authenticate distinct Separation-of-Duties personas via POST /api/auth/login
                </div>
              </div>
              <button type="button" onClick={() => setAccountModalOpen(false)}>
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
            <div className="p-4 flex flex-col gap-2 max-h-[65vh] overflow-y-auto">
              {demoAccounts.map((acc) => {
                const isActive = currentUser?.id === acc.id;
                return (
                  <button
                    key={acc.id}
                    type="button"
                    onClick={async () => {
                      const ok = await loginDemoAccount(acc.email);
                      if (ok) setAccountModalOpen(false);
                    }}
                    className={`w-full text-left p-3 rounded border flex items-center justify-between gap-2 transition-colors ${
                      isActive ? 'border-secondary bg-[#f0fdfa]' : 'border-border-subtle hover:bg-canvas-bg'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-label-md font-semibold text-on-surface">{acc.displayName}</span>
                        <span className="font-mono-badge text-[9px] px-1.5 py-0.5 rounded bg-surface-container text-on-tertiary-fixed-variant">
                          DEMO ACCOUNT
                        </span>
                      </div>
                      <div className="font-mono-data text-[11px] text-text-secondary">{acc.email}</div>
                      <div className="text-[11px] text-text-secondary">{acc.title} · {acc.roles.join(', ')}</div>
                    </div>
                    {isActive && <span className="font-mono-badge text-[10px] text-status-success">ACTIVE</span>}
                  </button>
                );
              })}
              {demoAccounts.length === 0 && (
                <div className="text-[12px] text-text-secondary p-3 rounded bg-canvas-bg border border-border-subtle">
                  Switch to <strong>LIVE MODE</strong> in the sidebar top bar or ensure backend server (`npm run dev:server`) is running to load seeded accounts.
                </div>
              )}
              {currentUser && (
                <button
                  type="button"
                  onClick={async () => {
                    await logoutBackend();
                    setAccountModalOpen(false);
                  }}
                  className="mt-2 py-2 px-3 rounded border border-[rgba(181,71,71,0.3)] bg-[#fef2f2] text-status-error font-label-md text-[12px]"
                >
                  Sign Out Current Session ({currentUser.email})
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-canvas-bg text-on-surface">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex fixed left-0 top-0 h-screen w-64 bg-sidebar-bg z-50 flex-col border-r border-[#1E385B] text-inverse-on-surface select-none">
        {renderSidebarContent(false)}
      </aside>

      {/* Tablet Compact Rail */}
      <aside className="hidden md:flex lg:hidden fixed left-0 top-0 h-screen w-16 bg-sidebar-bg z-50 flex-col border-r border-[#1E385B] text-inverse-on-surface select-none">
        {renderSidebarContent(true)}
      </aside>

      {/* Mobile Drawer */}
      {mobileNavOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="w-64 bg-sidebar-bg h-full border-r border-[#1E385B] text-inverse-on-surface">
            {renderSidebarContent(false)}
          </div>
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileNavOpen(false)}
            className="flex-1 bg-[#14243A]/40"
          />
        </div>
      )}

      {/* Main Column */}
      <div className="md:pl-16 lg:pl-64">
        {/* Top Fixed Header */}
        <header className="fixed top-0 left-0 md:left-16 lg:left-64 right-0 h-16 bg-surface border-b border-border-subtle z-40 flex items-center justify-between px-4 lg:px-6 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="md:hidden w-9 h-9 flex items-center justify-center rounded border border-border-subtle text-on-surface hover:bg-surface-container-low"
              aria-label="Open menu"
            >
              <span className="material-symbols-outlined text-[20px]">menu</span>
            </button>

            <div className="hidden sm:flex items-center gap-1.5 text-text-secondary font-label-md text-label-md shrink-0">
              <span className="material-symbols-outlined text-[18px] shrink-0">shield</span>
              <span className="hidden 2xl:inline">Gateway</span>
              <span className="hidden 2xl:inline text-outline-variant">/</span>
              <button
                type="button"
                onClick={() => setOrgRegion((r) => (r === 'US-East' ? 'EU-Central' : 'US-East'))}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-container-low border border-border-subtle text-on-surface hover:bg-surface-container transition-colors whitespace-nowrap shrink-0"
                title="Switch Enclave Cluster"
              >
                <span className="font-medium truncate max-w-[155px]">Acme Global Infrastructure</span>
                <span className="hidden xl:inline font-mono-badge text-mono-badge text-text-secondary">({orgRegion})</span>
                <span className="material-symbols-outlined text-[16px] shrink-0">expand_more</span>
              </button>
            </div>

            <div className="relative w-36 sm:w-52 xl:w-64 min-w-0">
              <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                <span className="material-symbols-outlined text-[18px] text-text-secondary">search</span>
              </div>
              <input
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                onFocus={() => setCommandPaletteOpen(true)}
                className="w-full h-9 pl-8 pr-11 rounded border border-border-subtle bg-canvas-bg font-body-sm text-body-sm text-on-surface placeholder:text-text-secondary focus:outline-none focus:border-secondary focus:bg-surface transition-all"
                placeholder="Search Action ID, Commit SHA, Envelope..."
                type="text"
              />
              <div className="absolute inset-y-0 right-0 pr-2 flex items-center pointer-events-none">
                <kbd className="font-mono-badge text-[10px] px-1.5 py-0.5 bg-surface rounded border border-border-subtle text-text-secondary">
                  ⌘K
                </kbd>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <div className="hidden xl:flex items-center gap-2">
              <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-[#ecfdf5] border border-[rgba(35,122,87,0.25)] text-status-success font-mono-badge text-mono-badge">
                <span className="h-1.5 w-1.5 rounded-full bg-status-success" />
                API GATEWAY: OPERATIONAL
              </div>
              <div
                className={`flex items-center gap-1.5 px-2 py-1 rounded border font-mono-badge text-mono-badge ${
                  mode === 'demo'
                    ? 'bg-[#f0fdfa] border-[rgba(22,124,128,0.25)] text-secondary'
                    : 'bg-[#fffbeb] border-[rgba(165,107,24,0.25)] text-status-warning'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${mode === 'demo' ? 'bg-secondary' : 'bg-status-warning'}`} />
                {mode === 'demo' ? 'DETECTIFAI: HEALTHY' : 'LIVE ENCLAVE MODE'}
              </div>
            </div>

            <div className="hidden sm:block h-4 w-px bg-border-subtle" />

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setC4SpecOpen(true)}
                className="w-8 h-8 flex items-center justify-center rounded text-text-secondary hover:text-on-surface hover:bg-surface-container-low transition-colors"
                title="C4 System Design Spec"
              >
                <span className="material-symbols-outlined text-[20px]">menu_book</span>
              </button>
              <button
                type="button"
                onClick={() => navigate('/incidents')}
                className="relative w-8 h-8 flex items-center justify-center rounded text-text-secondary hover:text-on-surface hover:bg-surface-container-low transition-colors"
                title="Security Alerts"
              >
                <span className="material-symbols-outlined text-[20px]">notifications</span>
                <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-error" />
              </button>
              <Link
                to="/break-glass"
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#fef2f2] border border-[rgba(181,71,71,0.25)] text-status-error hover:bg-error hover:text-white transition-all font-mono-badge text-mono-badge"
              >
                <span className="material-symbols-outlined text-[16px]">warning</span>
                <span className="hidden sm:inline">BREAK-GLASS</span>
              </Link>
            </div>

            <div className="hidden sm:block h-8 w-px bg-border-subtle" />

            <Link to="/voice-registry" title="Marcus Vance — Voice Biometric Registry">
              <img
                alt="Marcus Vance"
                className="w-8 h-8 rounded-full object-cover border border-border-subtle cursor-pointer"
                src={marcusAvatar}
              />
            </Link>
          </div>
        </header>

        {/* Main Scroll Area */}
        <main className="w-full pt-16 min-h-screen bg-canvas-bg overflow-x-hidden">
          {/* Global Environment Banner */}
          <div className="bg-surface-container-low border-b border-border-subtle px-4 lg:px-6 py-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2.5 min-w-0">
              <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-primary-container text-primary-fixed">
                <span className="material-symbols-outlined text-[14px] text-secondary-fixed">verified</span>
                <span className="font-mono-badge text-[10px] tracking-wider">C4 COMPLIANT</span>
              </div>
              <p className="font-body-sm text-body-sm text-on-surface">
                <span className="font-semibold text-primary">
                  {mode === 'demo' ? 'DEMO ENVIRONMENT' : 'LIVE BACKEND MODE'}
                </span>
                <span className="text-text-secondary mx-1.5">·</span>
                <span>
                  {mode === 'demo'
                    ? 'Realistic security fixtures active'
                    : currentUser
                      ? `Authenticated as ${currentUser.displayName} (DEMO ACCOUNT)`
                      : 'Sign in via sidebar account switcher to query persisted backend records'}
                </span>
                {mode === 'live' && !currentUser && (
                  <button
                    type="button"
                    onClick={() => setAccountModalOpen(true)}
                    className="ml-2 px-2 py-0.5 rounded bg-secondary text-white font-mono-badge text-[10px]"
                  >
                    Sign In
                  </button>
                )}
                <span className="hidden md:inline text-text-secondary mx-1.5">·</span>
                <span className="hidden md:inline text-text-secondary">
                  DetectifAI dual verification (Aletheia + Eidos) isolated behind backend adapter
                </span>
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMode(mode === 'demo' ? 'live' : 'demo')}
                className="font-mono-badge text-[10px] px-2 py-0.5 rounded border border-border-subtle bg-surface text-on-surface hover:border-secondary"
              >
                Switch to {mode === 'demo' ? 'LIVE' : 'DEMO'}
              </button>
              <span className="hidden sm:inline font-mono-badge text-[10px] text-text-secondary">
                SESSION NONCE: 0x9e4c...f201
              </span>
              <button
                type="button"
                onClick={() => setC4SpecOpen(true)}
                className="font-label-sm text-label-sm text-secondary hover:text-on-secondary-container transition-colors font-medium flex items-center gap-0.5"
              >
                View C4 Spec
                <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
              </button>
            </div>
          </div>

          {/* Live Toast Banner */}
          {toast && (
            <div className="fixed bottom-5 right-5 z-50 max-w-md rounded-lg border px-4 py-3 shadow-lg flex items-start gap-2.5 bg-surface border-border-subtle">
              <span
                className={`material-symbols-outlined text-[18px] mt-0.5 ${
                  toast.tone === 'success'
                    ? 'text-status-success'
                    : toast.tone === 'error'
                      ? 'text-status-error'
                      : toast.tone === 'warning'
                        ? 'text-status-warning'
                        : 'text-secondary'
                }`}
              >
                {toast.tone === 'success'
                  ? 'check_circle'
                  : toast.tone === 'error'
                    ? 'error'
                    : toast.tone === 'warning'
                      ? 'warning'
                      : 'info'}
              </span>
              <p className="font-body-sm text-body-sm text-on-surface">{toast.message}</p>
            </div>
          )}

          {children}
        </main>
      </div>

      {/* Command Palette / Quick Search Modal */}
      {commandPaletteOpen && (
        <div className="fixed inset-0 z-50 bg-[#14243A]/40 flex items-start justify-center pt-20 px-4">
          <div className="w-full max-w-2xl bg-surface rounded-lg border border-border-subtle shadow-2xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border-subtle">
              <span className="material-symbols-outlined text-text-secondary text-[18px]">search</span>
              <input
                autoFocus
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                placeholder="Jump to Action Envelope ID, Commit SHA, or route..."
                className="flex-1 bg-transparent font-body-md text-body-md text-on-surface focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setCommandPaletteOpen(false)}
                className="font-mono-badge text-[10px] px-2 py-0.5 rounded border border-border-subtle text-text-secondary"
              >
                ESC
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto divide-y divide-border-subtle">
              {matchingEnvelopes.map((env) => (
                <button
                  key={env.id}
                  type="button"
                  onClick={() => {
                    setSelectedEnvelopeId(env.id);
                    setCommandPaletteOpen(false);
                    navigate(env.details.kind === 'finance' ? '/finance-beneficiary' : '/approvals');
                  }}
                  className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-surface-container-low/60 text-left"
                >
                  <div>
                    <div className="font-mono-data text-mono-data font-semibold text-secondary">{env.id}</div>
                    <div className="font-body-sm text-body-sm text-on-surface">{env.targetTitle}</div>
                  </div>
                  <span className="font-mono-badge text-[10px] px-2 py-0.5 rounded border border-border-subtle bg-canvas-bg text-on-surface">
                    {env.state}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* C4 Architecture Spec Modal (Shows actual Stitch C4 Workflow Asset) */}
      {c4SpecOpen && (
        <div className="fixed inset-0 z-50 bg-[#14243A]/50 flex items-center justify-center p-4">
          <div className="w-full max-w-5xl max-h-[90vh] bg-surface rounded-lg border border-border-subtle shadow-2xl flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border-subtle flex items-center justify-between bg-primary-container text-white">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-secondary-fixed text-[20px]">architecture</span>
                <span className="font-headline-sm text-headline-sm">
                  ACTIONLOCK — C4 Enterprise System Design &amp; Authorization Lifecycle
                </span>
              </div>
              <button
                type="button"
                onClick={() => setC4SpecOpen(false)}
                className="px-2.5 py-1 rounded bg-[#1b2f4a] text-primary-fixed font-mono-badge text-[11px] hover:text-white"
              >
                CLOSE
              </button>
            </div>
            <div className="p-4 overflow-y-auto bg-canvas-bg">
              <img
                src={c4SystemDesign}
                alt="ACTIONLOCK C4 Enterprise System Design & User Workflow"
                className="w-full h-auto rounded border border-border-subtle bg-white"
              />
            </div>
          </div>
        </div>
      )}

      {/* New Protected Action Modal */}
      {newActionModalOpen && (
        <div className="fixed inset-0 z-50 bg-[#14243A]/40 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-surface rounded-lg border border-border-subtle shadow-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border-subtle flex items-center justify-between bg-primary-container text-white">
              <span className="font-headline-sm text-headline-sm">Issue Protected Action Envelope</span>
              <button
                type="button"
                onClick={() => setNewActionModalOpen(false)}
                className="text-outline-variant hover:text-white"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>
            <form
              className="p-5 flex flex-col gap-3.5"
              onSubmit={async (e) => {
                e.preventDefault();
                const created = await createProtectedAction(newActionForm);
                setNewActionModalOpen(false);
                if (created) {
                  navigate(created.details.kind === 'finance' ? '/finance-beneficiary' : '/approvals');
                }
              }}
            >
              <div>
                <label className="block font-label-sm text-label-sm text-text-secondary mb-1">Action Category</label>
                <select
                  value={newActionForm.category}
                  onChange={(e) => setNewActionForm((f) => ({ ...f, category: e.target.value as ActionCategory }))}
                  className="w-full h-9 px-3 rounded border border-border-subtle bg-surface font-body-sm text-on-surface"
                >
                  <option value="DevSecOps">DevSecOps (GitHub / Terraform)</option>
                  <option value="Financial">Financial (Simulated Treasury Wire)</option>
                  <option value="IAM">IAM (Privileged Role Elevation)</option>
                </select>
              </div>
              <div>
                <label className="block font-label-sm text-label-sm text-text-secondary mb-1">Target Title</label>
                <input
                  required
                  value={newActionForm.targetTitle}
                  onChange={(e) => setNewActionForm((f) => ({ ...f, targetTitle: e.target.value }))}
                  className="w-full h-9 px-3 rounded border border-border-subtle bg-surface font-body-sm text-on-surface"
                />
              </div>
              <div>
                <label className="block font-label-sm text-label-sm text-text-secondary mb-1">
                  Repository / Vendor / Target Reference
                </label>
                <input
                  required
                  value={newActionForm.amountOrRepo}
                  onChange={(e) => setNewActionForm((f) => ({ ...f, amountOrRepo: e.target.value }))}
                  className="w-full h-9 px-3 rounded border border-border-subtle bg-surface font-mono-data text-on-surface"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-label-sm text-label-sm text-text-secondary mb-1">Requester</label>
                  <input
                    required
                    value={newActionForm.requester}
                    onChange={(e) => setNewActionForm((f) => ({ ...f, requester: e.target.value }))}
                    className="w-full h-9 px-3 rounded border border-border-subtle bg-surface font-body-sm text-on-surface"
                  />
                </div>
                <div>
                  <label className="block font-label-sm text-label-sm text-text-secondary mb-1">Claimed Approver</label>
                  <input
                    required
                    value={newActionForm.claimedApprover}
                    onChange={(e) => setNewActionForm((f) => ({ ...f, claimedApprover: e.target.value }))}
                    className="w-full h-9 px-3 rounded border border-border-subtle bg-surface font-body-sm text-on-surface"
                  />
                </div>
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setNewActionModalOpen(false)}
                  className="px-3.5 py-2 rounded border border-border-subtle bg-surface text-on-surface font-label-md"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded bg-secondary hover:bg-[#005a5e] text-white font-label-md"
                >
                  Canonicalize &amp; Issue Challenge
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
