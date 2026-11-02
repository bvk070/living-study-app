import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';
import { useAuth } from '@workspace/replit-auth-web';
import {
  ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, ChevronDown, CircleHelp,
  Clock3, FileText, Filter, FolderOpen, Layers3, Library, LoaderCircle, LogIn, LogOut,
  Menu, RefreshCw, Sparkles, Trash2, Upload, X, XCircle,
} from 'lucide-react';
import {
  getGetDocumentQueryKey, getGetReviewQueueQueryKey, getGetReviewStatsQueryKey,
  getListApprovedCardsQueryKey, getListDocumentsQueryKey, useApproveReviewItem,
  useDeleteDocument, useDiscardReviewItem, useGenerateDocumentSections, useGetDocument,
  useGetReviewQueue, useGetReviewStats, useImportDocument, useListApprovedCards,
  useListDocuments, useRequestUploadUrl, useRetrySectionGeneration,
} from '@workspace/api-client-react';
import type { CardKind, DiscardItemInputReason, StudyDocument, StudySection } from '@workspace/api-client-react';
import NotFound from '@/pages/not-found';
import './index.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } });
const reasons: { value: Exclude<DiscardItemInputReason, null>; label: string }[] = [
  { value: 'added_outside_info', label: 'Added information outside the source' },
  { value: 'dropped_a_condition', label: 'Dropped an important condition' },
  { value: 'merged_unrelated_sentences', label: 'Merged unrelated sentences' },
  { value: 'factually_wrong_per_source', label: 'Factually wrong per source' },
  { value: 'other', label: 'Other' },
];
const prettyDate = (value: string) => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
const kindName = (kind: CardKind) => kind === 'quiz' ? 'Quiz' : 'Flashcard';
const statusName = (status: string) => status === 'done' ? 'Ready' : status === 'failed' ? 'Needs retry' : status === 'generating' ? 'Making cards' : status === 'pending' ? 'Not started' : status;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';

function AppShell({ children, auth }: { children: ReactNode; auth: ReturnType<typeof useAuth> }) {
  const { user, isAuthenticated, login, logout } = auth;
  const [path] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const navItems = [
    { href: '/', label: 'My documents', icon: FolderOpen },
    { href: '/review', label: 'Review drafts', icon: CheckCircle2 },
    { href: '/library', label: 'Study library', icon: Library },
    { href: '/stats', label: 'Review insights', icon: Layers3 },
  ];
  return <div className="min-h-[100dvh] bg-background paper-grain">
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[252px] flex-col border-r border-sidebar-border bg-sidebar px-5 py-7 md:flex">
      <Link href="/" className="mb-11 flex items-center gap-3 px-2 text-foreground no-underline" data-testid="link-brand">
        <span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-primary text-primary-foreground"><BookOpen size={19} strokeWidth={1.8}/></span>
        <span><span className="serif block text-[22px] leading-[.92]">Living Study</span><span className="serif text-[22px] leading-[.92] italic">Guide</span></span>
      </Link>
      <div className="mono mb-3 px-3 text-[10px] uppercase tracking-[.18em] text-muted-foreground">Your study space</div>
      <nav className="space-y-1" aria-label="Main navigation">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = path === href || (href === '/review' && path.startsWith('/review'));
          return <Link key={href} href={href} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-[13px] font-medium no-underline transition-colors ${active ? 'bg-sidebar-accent text-foreground' : 'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground'}`} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`}>
            <Icon size={17} strokeWidth={1.8}/>{label}{href === '/review' && <ReviewCount/>}
          </Link>;
        })}
      </nav>
      <div className="mt-auto rounded-2xl border border-sidebar-border/80 bg-background/50 p-4">
        <div className="mb-2 flex items-center gap-2 text-primary"><Sparkles size={15}/><span className="mono text-[10px] uppercase tracking-[.13em]">A thoughtful loop</span></div>
        <p className="m-0 text-[12px] leading-5 text-muted-foreground">Every card is checked against your own notes before it joins your library.</p>
      </div>
      <div className="mt-5 border-t border-sidebar-border pt-4">
        {isAuthenticated ? <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/35 text-xs font-semibold text-foreground">{(user?.firstName?.[0] ?? user?.email?.[0] ?? 'S').toUpperCase()}</span>
            <div className="min-w-0 flex-1"><div className="truncate text-[12px] font-medium">{user?.firstName || user?.email || 'Your account'}</div><button className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground" onClick={() => logout()} data-testid="button-sign-out"><LogOut size={12}/> Sign out</button></div>
          </div> :
          <button className="flex w-full items-center justify-center gap-2 rounded-xl border border-sidebar-border bg-background px-3 py-2.5 text-[12px] font-semibold text-foreground hover:bg-sidebar-accent" onClick={() => login()} data-testid="button-sign-in"><LogIn size={15}/> Sign in to save your work</button>}
      </div>
    </aside>
    <header className="sticky top-0 z-20 flex h-[62px] items-center justify-between border-b border-border/80 bg-background/90 px-4 backdrop-blur-md md:hidden">
      <Link href="/" className="flex items-center gap-2 text-foreground no-underline"><span className="flex h-8 w-8 items-center justify-center rounded-[11px] bg-primary text-primary-foreground"><BookOpen size={16}/></span><span className="serif text-[21px]">Living Study Guide</span></Link>
      <button onClick={() => setMenuOpen(!menuOpen)} className="rounded-lg p-2 text-foreground hover:bg-muted" aria-label="Open navigation" data-testid="button-mobile-menu">{menuOpen ? <X size={20}/> : <Menu size={20}/>}</button>
      {menuOpen && <nav className="absolute left-0 right-0 top-[61px] border-b border-border bg-background p-3 shadow-lg">
        {navItems.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setMenuOpen(false)} className={`flex items-center gap-3 rounded-xl px-3 py-3 text-sm no-underline ${path === href ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}><Icon size={17}/>{label}</Link>)}
        {isAuthenticated ? <button className="mt-2 w-full rounded-xl px-3 py-3 text-left text-sm text-muted-foreground" onClick={() => logout()}>Sign out</button> : <button className="mt-2 w-full rounded-xl px-3 py-3 text-left text-sm text-muted-foreground" onClick={() => login()}>Sign in</button>}
      </nav>}
    </header>
    <main className="min-h-[100dvh] px-4 pb-12 pt-7 md:ml-[252px] md:px-10 md:pt-10 lg:px-14">
      <div className="mx-auto max-w-[1100px]">{children}</div>
    </main>
    <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t border-border bg-background/95 px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-2 backdrop-blur md:hidden">
      {navItems.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`flex flex-col items-center gap-1 py-1 text-[9px] no-underline ${path === href ? 'text-primary' : 'text-muted-foreground'}`}><Icon size={18}/><span>{label.split(' ')[0]}</span></Link>)}
    </nav>
  </div>;
}

function ReviewCount() {
  const { data } = useGetReviewQueue(undefined, { query: { queryKey: getGetReviewQueueQueryKey(), staleTime: 30_000 } });
  return data?.pendingCount ? <span className="mono ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-accent/40 px-1.5 text-[10px] text-foreground">{data.pendingCount}</span> : null;
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
    <div><div className="mono mb-2 text-[10px] uppercase tracking-[.19em] text-primary">{eyebrow}</div><h1 className="serif m-0 text-[39px] leading-[.98] tracking-[-.02em] text-foreground sm:text-[47px]">{title}</h1>{description && <p className="mb-0 mt-3 max-w-[580px] text-[14px] leading-6 text-muted-foreground">{description}</p>}</div>{action}
  </div>;
}

function Notice({ children, tone = 'error', onDismiss }: { children: ReactNode; tone?: 'error' | 'success'; onDismiss?: () => void }) {
  return <div role="status" className={`mb-5 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${tone === 'error' ? 'border-destructive/20 bg-destructive/5 text-destructive' : 'border-primary/20 bg-primary/5 text-primary'}`}>
    {tone === 'error' ? <CircleHelp size={17} className="mt-0.5 shrink-0"/> : <CheckCircle2 size={17} className="mt-0.5 shrink-0"/>}<div className="flex-1">{children}</div>{onDismiss && <button onClick={onDismiss} aria-label="Dismiss message"><X size={15}/></button>}
  </div>;
}

function Skeleton({ lines = 3 }: { lines?: number }) {
  return <div className="space-y-3" aria-label="Loading"><div className="h-24 animate-pulse rounded-2xl bg-muted"/>{Array.from({ length: lines }).map((_, i) => <div key={i} className="h-[72px] animate-pulse rounded-2xl bg-muted/75"/>)}</div>;
}

function Dashboard() {
  const { data: documents, isLoading, isError, error, refetch } = useListDocuments({ query: { queryKey: getListDocumentsQueryKey() } });
  const { data: queue } = useGetReviewQueue(undefined, { query: { queryKey: getGetReviewQueueQueryKey() } });
  const requestUpload = useRequestUploadUrl();
  const importDocument = useImportDocument();
  const deleteDocument = useDeleteDocument();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'error' | 'success' } | null>(null);
  const [uploading, setUploading] = useState(false);
  const onPick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setNotice(null);
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) { setNotice({ text: 'Choose a PDF file to add it to your study space.', tone: 'error' }); return; }
    if (file.size > 52_428_800) { setNotice({ text: 'This PDF is larger than 50 MB. Try a smaller file.', tone: 'error' }); return; }
    setUploading(true);
    try {
      const signed = await requestUpload.mutateAsync({ data: { name: file.name, size: file.size, contentType: 'application/pdf' } });
      const put = await fetch(signed.uploadURL, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: file });
      if (!put.ok) throw new Error('The PDF could not be uploaded. Please try again.');
      await importDocument.mutateAsync({ data: { name: file.name, objectPath: signed.objectPath } });
      await qc.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
      setNotice({ text: 'Your notes are in. Sections are being prepared for study.', tone: 'success' });
    } catch (e) { setNotice({ text: errorMessage(e), tone: 'error' }); }
    finally { setUploading(false); event.target.value = ''; }
  };
  const handleDelete = async (doc: StudyDocument) => {
    if (!window.confirm(`Remove “${doc.name}” and its study data?`)) return;
    try { await deleteDocument.mutateAsync({ documentId: doc.id }); await qc.invalidateQueries({ queryKey: getListDocumentsQueryKey() }); }
    catch (e) { setNotice({ text: errorMessage(e), tone: 'error' }); }
  };
  const docs = documents ?? [];
  const totalSentences = docs.reduce((sum, d) => sum + d.sentenceCount, 0);
  const pending = queue?.pendingCount ?? 0;
  return <div className="reveal">
    <PageHeading eyebrow="A space for what you're learning" title="Your notes, made study-ready." description="Bring in your course PDFs. Review every AI-made card against the source before it becomes yours." action={<button onClick={() => inputRef.current?.click()} disabled={uploading} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-sm transition-transform hover:-translate-y-0.5 disabled:opacity-60" data-testid="button-add-pdf"><Upload size={16}/>{uploading ? 'Adding notes…' : 'Add a PDF'}</button>}/>
    <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={onPick} data-testid="input-pdf-upload"/>
    {notice && <Notice tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</Notice>}
    <section className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Metric label="Documents" value={docs.length} detail="in your study space" icon={<FileText size={17}/>} />
      <Metric label="Source sentences" value={totalSentences} detail="ready to revisit" icon={<BookOpen size={17}/>} />
      <Metric label="Waiting for you" value={pending} detail={pending === 1 ? 'draft needs a human eye' : 'drafts need a human eye'} icon={<CheckCircle2 size={17}/>} emphasize />
    </section>
    <div className="mb-4 flex items-center justify-between"><div><div className="mono text-[10px] uppercase tracking-[.17em] text-muted-foreground">Your shelf</div><h2 className="serif mb-0 mt-1 text-[29px]">Study documents</h2></div>{docs.length > 0 && <span className="mono text-[11px] text-muted-foreground">{docs.length} {docs.length === 1 ? 'document' : 'documents'}</span>}</div>
    {isLoading ? <Skeleton/> : isError ? <div className="rounded-2xl border border-destructive/20 bg-card p-7"><Notice>{errorMessage(error)}</Notice><button onClick={() => refetch()} className="rounded-lg border border-border px-4 py-2 text-sm" data-testid="button-retry-documents">Try again</button></div> : docs.length === 0 ?
      <div className="overflow-hidden rounded-[24px] border border-border bg-card">
        <div className="grid gap-8 p-7 sm:grid-cols-[1fr_240px] sm:items-center sm:p-10">
          <div><div className="mono mb-3 text-[10px] uppercase tracking-[.18em] text-primary">Start with your own material</div><h3 className="serif m-0 max-w-[550px] text-[34px] leading-[1.05]">A good study guide begins with good notes.</h3><p className="mt-4 max-w-[490px] text-[14px] leading-6 text-muted-foreground">Add a lecture handout or class notes PDF. We’ll find the sections and sentences worth practicing, then you decide what belongs in your library.</p><button onClick={() => inputRef.current?.click()} disabled={uploading} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground" data-testid="button-upload-empty"><Upload size={16}/>{uploading ? 'Adding notes…' : 'Choose your first PDF'}</button></div>
          <div className="relative mx-auto flex h-[208px] w-[212px] items-center justify-center rounded-[48%_52%_48%_52%] bg-[#e7eee6]">
            <div className="absolute h-[142px] w-[117px] rotate-[-8deg] rounded-md border border-[#c5d0c4] bg-[#f8f6ef] shadow-[10px_12px_0_#d5dfd4]"/>
            <div className="relative flex h-[144px] w-[118px] rotate-[4deg] flex-col rounded-md border border-[#c5d0c4] bg-[#fbfaf5] px-4 py-4 shadow-sm"><span className="mono text-[8px] uppercase tracking-[.17em] text-primary">Chapter 01</span><span className="serif mt-2 text-[21px] leading-5">The living<br/>page</span><span className="mt-3 h-px bg-border"/><span className="mt-2 h-1 w-16 rounded bg-[#d8ddd4]"/><span className="mt-2 h-1 w-14 rounded bg-[#d8ddd4]"/><span className="mt-2 h-1 w-17 rounded bg-[#d8ddd4]"/></div>
            <span className="absolute bottom-7 right-6 flex h-10 w-10 items-center justify-center rounded-full bg-accent text-foreground shadow-sm"><Sparkles size={17}/></span>
          </div>
        </div>
        <div className="grid grid-cols-1 border-t border-border bg-muted/40 sm:grid-cols-3">
          {['Import your notes', 'Check each source', 'Keep only what you trust'].map((t,i) => <div key={t} className={`flex items-center gap-3 px-6 py-4 text-[12px] text-muted-foreground ${i ? 'border-t border-border sm:border-l sm:border-t-0' : ''}`}><span className="mono flex h-6 w-6 items-center justify-center rounded-full border border-border bg-card text-[10px] text-primary">0{i+1}</span>{t}</div>)}
        </div>
      </div> :
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {docs.map((doc,index) => <div key={doc.id} className={`group flex flex-col gap-4 px-5 py-5 transition-colors hover:bg-muted/35 sm:flex-row sm:items-center sm:px-6 ${index ? 'border-t border-border' : ''}`} data-testid={`document-row-${doc.id}`}>
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-[#e6ede6] text-primary"><FileText size={20} strokeWidth={1.7}/></div>
          <div className="min-w-0 flex-1"><Link href={`/documents/${doc.id}`} className="block truncate text-[14px] font-semibold text-foreground no-underline hover:text-primary" data-testid={`link-document-${doc.id}`}>{doc.name}</Link><div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground"><span>{doc.pageCount} pages</span><span className="h-1 w-1 rounded-full bg-border"/><span>{doc.sectionCount} sections</span><span className="h-1 w-1 rounded-full bg-border"/><span>{doc.sentenceCount} sentences</span><span className="h-1 w-1 rounded-full bg-border"/><span>Added {prettyDate(doc.createdAt)}</span></div></div>
          <span className={`w-fit rounded-full px-2.5 py-1 text-[10px] font-medium ${doc.status === 'parsed' ? 'bg-primary/10 text-primary' : 'bg-destructive/10 text-destructive'}`}>{doc.status === 'parsed' ? 'Parsed' : 'Parse failed'}</span>
          <Link href={`/documents/${doc.id}`} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-primary no-underline sm:ml-2" data-testid={`link-open-document-${doc.id}`}>Open <ArrowRight size={14}/></Link>
          <button onClick={() => handleDelete(doc)} disabled={deleteDocument.isPending} title="Delete document" aria-label={`Delete ${doc.name}`} className="self-end rounded-lg p-2 text-muted-foreground opacity-70 hover:bg-destructive/10 hover:text-destructive sm:self-auto sm:opacity-0 sm:group-hover:opacity-100" data-testid={`button-delete-document-${doc.id}`}><Trash2 size={15}/></button>
        </div>)}
      </div>}
    <div className="mt-7 flex items-center gap-2 text-[11px] text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-primary/60"/>{pending ? `${pending} draft${pending === 1 ? '' : 's'} ${pending === 1 ? 'is' : 'are'} ready for your review.` : 'Your library grows only with your approval.'}<Link href="/review" className="ml-1 font-semibold text-primary no-underline hover:underline">Review drafts</Link></div>
  </div>;
}

function Metric({ label, value, detail, icon, emphasize = false }: { label: string; value: number; detail: string; icon: ReactNode; emphasize?: boolean }) {
  return <div className={`rounded-2xl border px-4 py-4 ${emphasize ? 'border-primary/20 bg-[#eaf0e9]' : 'border-border bg-card'}`}><div className="flex items-center justify-between"><span className="text-[11px] font-medium text-muted-foreground">{label}</span><span className="text-primary">{icon}</span></div><div className="serif mt-3 text-[31px] leading-none">{value}</div><div className="mt-2 text-[10px] text-muted-foreground">{detail}</div></div>;
}

function DocumentPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { data, isLoading, isError, error, refetch } = useGetDocument(id, { query: {
    queryKey: getGetDocumentQueryKey(id),
    enabled: !!id,
    refetchInterval: (query) => query.state.data?.sections.some((section) => section.status === 'generating') ? 1800 : false,
  } });
  const generate = useGenerateDocumentSections();
  const retry = useRetrySectionGeneration();
  const qc = useQueryClient();
  const [notice, setNotice] = useState('');
  const [retryingSectionId, setRetryingSectionId] = useState<string | null>(null);
  const afterGenerate = async () => { setNotice(''); try { await generate.mutateAsync({ documentId: id }); await qc.invalidateQueries({ queryKey: getGetDocumentQueryKey(id) }); } catch (e) { setNotice(errorMessage(e)); } };
  const retryOne = async (sectionId: string) => { setNotice(''); setRetryingSectionId(sectionId); try { await retry.mutateAsync({ documentId: id, sectionId }); await qc.invalidateQueries({ queryKey: getGetDocumentQueryKey(id) }); } catch (e) { setNotice(errorMessage(e)); } finally { setRetryingSectionId(null); } };
  if (isLoading) return <Skeleton lines={4}/>;
  if (isError || !data) return <><Link href="/" className="mb-5 inline-flex items-center gap-2 text-sm text-muted-foreground no-underline"><ArrowLeft size={15}/> Documents</Link><Notice>{errorMessage(error)}</Notice><button onClick={() => refetch()} className="rounded-lg border border-border px-4 py-2 text-sm" data-testid="button-retry-document">Try again</button></>;
  const doc = data.document;
  const sections = data.sections ?? [];
  const ready = sections.filter((s) => s.status === 'done').length;
  const canGenerate = sections.some((s) => s.status === 'pending');
  return <div className="reveal">
    <Link href="/" className="mb-6 inline-flex items-center gap-2 text-[12px] font-medium text-muted-foreground no-underline hover:text-primary" data-testid="link-back-documents"><ArrowLeft size={14}/> All documents</Link>
    <PageHeading eyebrow="Source document" title={doc.name} description={`${doc.pageCount} pages · ${sections.length} sections · ${doc.sentenceCount} source sentences`} action={<button onClick={afterGenerate} disabled={generate.isPending || !canGenerate} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-55" data-testid="button-generate-all">{generate.isPending ? <LoaderCircle className="animate-spin" size={16}/> : <Sparkles size={16}/>}Generate pending sections</button>}/>
    {notice && <Notice onDismiss={() => setNotice('')}>{notice}</Notice>}
    <div className="mb-6 flex flex-wrap items-center gap-5 rounded-2xl border border-border bg-card px-5 py-4">
      <div className="flex items-center gap-2 text-[12px]"><span className="h-2 w-2 rounded-full bg-primary"/><strong>{ready}</strong><span className="text-muted-foreground">sections ready</span></div>
      <div className="flex items-center gap-2 text-[12px]"><span className="h-2 w-2 rounded-full bg-accent"/><strong>{sections.reduce((n,s)=>n+s.generatedCardCount,0)}</strong><span className="text-muted-foreground">drafts made</span></div>
      <div className="flex items-center gap-2 text-[12px]"><span className="h-2 w-2 rounded-full bg-border"/><strong>{sections.reduce((n,s)=>n+s.uncoveredSentenceCount,0)}</strong><span className="text-muted-foreground">sentences uncovered</span></div>
      <div className="ml-auto flex items-center gap-1.5 text-[10px] text-muted-foreground"><Clock3 size={13}/> Cards remain drafts until you approve</div>
    </div>
    <div className="mb-3 flex items-end justify-between"><div><div className="mono text-[10px] uppercase tracking-[.17em] text-muted-foreground">Parsed structure</div><h2 className="serif mb-0 mt-1 text-[28px]">Sections from your notes</h2></div><span className="mono text-[10px] text-muted-foreground">SOURCE PREVIEW</span></div>
    {sections.length ? <div className="space-y-3">{sections.map((section) => <SectionPanel key={section.id} section={section} retrying={retryingSectionId === section.id} onRetry={() => retryOne(section.id)}/>)}</div> :
      <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center"><FileText className="mx-auto text-muted-foreground" size={24}/><h3 className="serif mt-3 text-[24px]">No sections found yet</h3><p className="text-sm text-muted-foreground">The document may still be parsing. Try refreshing in a moment.</p><button onClick={() => refetch()} className="rounded-lg border border-border px-4 py-2 text-sm" data-testid="button-refresh-sections">Refresh</button></div>}
  </div>;
}

function SectionPanel({ section, retrying, onRetry }: { section: StudySection; retrying: boolean; onRetry: () => void }) {
  const [expanded, setExpanded] = useState(section.order === 1);
  const statusTone = section.status === 'done' ? 'text-primary bg-primary/10' : section.status === 'failed' ? 'text-destructive bg-destructive/10' : section.status === 'generating' ? 'text-[#986a32] bg-[#f5eddf]' : 'text-muted-foreground bg-muted';
  return <article className="overflow-hidden rounded-2xl border border-border bg-card" data-testid={`section-${section.id}`}>
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
      <button onClick={() => setExpanded(!expanded)} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-expanded={expanded} data-testid={`button-toggle-section-${section.id}`}>
        <span className="mono flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] text-muted-foreground">{String(section.order).padStart(2,'0')}</span>
        <span className="min-w-0 flex-1"><span className="block truncate text-[14px] font-semibold">{section.title}</span><span className="mt-1 block text-[10px] text-muted-foreground">{section.sentenceCount} sentences · {section.generatedCardCount} drafts · {section.uncoveredSentenceCount} uncovered</span></span>
        <ChevronDown size={16} className={`shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`}/>
      </button>
      <div className="flex items-center justify-between gap-3 sm:justify-end">
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${statusTone}`}>{statusName(section.status)}</span>
        {(section.status === 'pending' || section.status === 'failed') && <button onClick={onRetry} disabled={retrying} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[11px] font-semibold hover:bg-muted disabled:opacity-50" data-testid={`button-generate-section-${section.id}`}><RefreshCw size={13} className={retrying ? 'animate-spin' : ''}/>{section.status === 'failed' ? 'Retry' : 'Generate'}</button>}
      </div>
    </div>
    {section.error && <div className="border-t border-destructive/10 bg-destructive/5 px-5 py-3 text-[12px] text-destructive">{section.error}</div>}
    {expanded && <div className="border-t border-border bg-[#faf9f4] px-5 py-4">
      <div className="mono mb-3 flex items-center gap-2 text-[9px] uppercase tracking-[.16em] text-muted-foreground"><span className="h-px w-5 bg-accent"/>From the source PDF</div>
      {section.previewSentences.length ? <ol className="space-y-2.5">{section.previewSentences.map((sentence) => <li key={sentence.order} className="flex gap-3 text-[12px] leading-5 text-foreground/80"><span className="mono mt-0.5 w-6 shrink-0 text-right text-[9px] text-muted-foreground">{String(sentence.order).padStart(2,'0')}</span><span>{sentence.subheading && <><strong className="mr-1 text-primary">{sentence.subheading}</strong></>}{sentence.text}</span></li>)}</ol> : <p className="m-0 text-[12px] italic text-muted-foreground">No sentence preview available for this section.</p>}
    </div>}
  </article>;
}

function ReviewPage() {
  const { data, isLoading, isError, error, refetch } = useGetReviewQueue(undefined, { query: { queryKey: getGetReviewQueueQueryKey() } });
  const approve = useApproveReviewItem();
  const discard = useDiscardReviewItem();
  const qc = useQueryClient();
  const item = data?.item ?? null;
  const [editing, setEditing] = useState(false);
  const [front, setFront] = useState('');
  const [answer, setAnswer] = useState('');
  const [options, setOptions] = useState<string[]>(['','','','']);
  const [correct, setCorrect] = useState('');
  const [reason, setReason] = useState<DiscardItemInputReason>(null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const itemIdRef = useRef('');
  useEffect(() => {
    if (!item || itemIdRef.current === item.id) return;
    itemIdRef.current = item.id; setFront(item.front); setAnswer(item.answer);
    setOptions([...item.quizOptions, '', '', '', ''].slice(0,4)); setCorrect(item.correctAnswer ?? '');
    setEditing(false); setDiscardOpen(false); setReason(null); setNotice('');
  }, [item]);
  const refreshQueue = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: getGetReviewQueueQueryKey() }),
      qc.invalidateQueries({ queryKey: getListApprovedCardsQueryKey() }),
      qc.invalidateQueries({ queryKey: getGetReviewStatsQueryKey() }),
    ]);
  };
  const approveCurrent = async () => {
    if (!item || !front.trim() || !answer.trim()) { setNotice('Add a question and answer before approving.'); return; }
    try {
      await approve.mutateAsync({ itemId: item.id, data: { front: front.trim(), answer: answer.trim(), quizOptions: item.kind === 'quiz' ? options.map(o => o.trim()).filter(Boolean).slice(0,4) : [], correctAnswer: item.kind === 'quiz' ? correct : null } });
      await refreshQueue();
    } catch (e) { setNotice(errorMessage(e)); }
  };
  const discardCurrent = async () => {
    if (!item) return;
    try { await discard.mutateAsync({ itemId: item.id, data: { reason } }); await refreshQueue(); }
    catch (e) { setNotice(errorMessage(e)); }
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && ['INPUT','TEXTAREA','SELECT'].includes(event.target.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey || !item) return;
      const key = event.key.toLowerCase();
      if (key === 'a' && !approve.isPending) { event.preventDefault(); void approveCurrent(); }
      if (key === 'e') { event.preventDefault(); setEditing(true); }
      if (key === 'd') { event.preventDefault(); setDiscardOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  if (isLoading) return <><PageHeading eyebrow="Human review" title="A second look, from you."/><Skeleton lines={2}/></>;
  if (isError) return <><PageHeading eyebrow="Human review" title="A second look, from you."/><Notice>{errorMessage(error)}</Notice><button onClick={() => refetch()} className="rounded-lg border border-border px-4 py-2 text-sm" data-testid="button-retry-review">Try again</button></>;
  return <div className="reveal">
    <PageHeading eyebrow="Human review" title="A second look, from you." description="Compare each draft with the exact source it came from. Nothing enters your library until you say so." action={data && <div className="rounded-xl border border-border bg-card px-4 py-2.5 text-right"><span className="serif text-[24px]">{data.pendingCount}</span><span className="ml-2 text-[11px] text-muted-foreground">drafts left</span></div>}/>
    {notice && <Notice onDismiss={() => setNotice('')}>{notice}</Notice>}
    {!item ? <div className="rounded-[24px] border border-border bg-card px-6 py-14 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary"><Check size={24}/></div><div className="mono mt-5 text-[10px] uppercase tracking-[.18em] text-primary">All caught up</div><h2 className="serif mt-2 text-[34px]">Your review desk is clear.</h2><p className="mx-auto max-w-[420px] text-[13px] leading-6 text-muted-foreground">New drafts will wait here after generation. Your approved cards are ready whenever you want to study.</p><Link href="/library" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground no-underline" data-testid="link-review-library">Visit your library <ArrowRight size={15}/></Link>
    </div> : <div className="grid gap-4 lg:grid-cols-[.92fr_1.08fr]">
      <div className="rounded-2xl border border-[#d6c7ad] bg-[#f3eee3] p-5 sm:p-6" data-testid="source-context">
        <div className="mb-5 flex items-center justify-between"><div className="mono flex items-center gap-2 text-[10px] uppercase tracking-[.17em] text-[#73664f]"><FileText size={14}/> Your source</div><span className="rounded-full bg-[#e3dac7] px-2.5 py-1 text-[9px] text-[#716249]">{item.sources.length} cited {item.sources.length === 1 ? 'sentence' : 'sentences'}</span></div>
        <div className="mb-4"><div className="text-[11px] font-semibold text-[#665b47]">{item.documentName || 'Source document'}</div><div className="mt-1 text-[11px] text-[#877a64]">{item.section}</div></div>
        <div className="space-y-3">{item.sources.map((source,i) => <blockquote key={source.id} className="m-0 border-l-2 border-accent/80 pl-4 text-[13px] leading-[1.75] text-[#514c41]"><span className="mono mr-2 text-[9px] text-[#938771]">S{i+1}</span>{source.text}</blockquote>)}</div>
        {!item.sources.length && <p className="text-[12px] italic text-[#877a64]">No source sentence was attached to this draft.</p>}
        <div className="mt-6 border-t border-[#d8cebb] pt-4"><div className="mono mb-1 text-[9px] uppercase tracking-[.15em] text-[#8b7b60]">Context</div><div className="text-[11px] leading-5 text-[#716750]">{item.documentName || 'Document'} <span className="px-1">/</span> {item.section}</div></div>
      </div>
      <div className="rounded-2xl border border-border bg-card p-5 sm:p-6" data-testid="ai-draft">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2"><div className="mono flex items-center gap-2 text-[10px] uppercase tracking-[.17em] text-primary"><Sparkles size={14}/> AI draft</div><span className={`rounded-full px-2.5 py-1 text-[9px] ${item.kind === 'quiz' ? 'bg-[#e7edf1] text-[#44616d]' : 'bg-primary/10 text-primary'}`}>{kindName(item.kind)}</span></div>
        <label className="mb-2 block text-[10px] font-semibold uppercase tracking-[.12em] text-muted-foreground">Prompt / front</label>
        {editing ? <textarea value={front} onChange={e=>setFront(e.target.value)} rows={3} className="mb-5 w-full resize-y rounded-xl border border-input bg-background p-3 text-[14px] leading-6 outline-none focus:ring-2 focus:ring-ring/25" data-testid="input-review-front"/> : <div className="serif mb-5 text-[25px] leading-[1.2]">{item.front}</div>}
        {item.kind === 'quiz' ? <div className="mb-5 space-y-2">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[.12em] text-muted-foreground">Four choices · correct answer marked</div>
          {(editing ? options : item.quizOptions).slice(0,4).map((option,index) => <div key={index} className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 ${option === (editing ? correct : item.correctAnswer) ? 'border-primary/35 bg-primary/5' : 'border-border bg-background'}`}>
            <span className={`mono flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] ${option === (editing ? correct : item.correctAnswer) ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>{String.fromCharCode(65+index)}</span>
            {editing ? <div className="flex flex-1 items-center gap-2"><input value={options[index] ?? ''} onChange={e=>setOptions(options.map((o,j)=>j===index?e.target.value:o))} className="min-w-0 flex-1 bg-transparent text-[12px] outline-none" aria-label={`Choice ${index+1}`} data-testid={`input-quiz-option-${index+1}`}/><input type="radio" checked={correct === option && !!option} onChange={()=>setCorrect(option)} aria-label={`Mark choice ${index+1} correct`} data-testid={`radio-correct-option-${index+1}`}/></div> : <span className="text-[12px] leading-5">{option}</span>}
            {!editing && option === item.correctAnswer && <Check size={14} className="ml-auto mt-0.5 shrink-0 text-primary"/>}
          </div>)}
        </div> : <><label className="mb-2 block text-[10px] font-semibold uppercase tracking-[.12em] text-muted-foreground">Answer</label>{editing ? <textarea value={answer} onChange={e=>setAnswer(e.target.value)} rows={4} className="mb-5 w-full resize-y rounded-xl border border-input bg-background p-3 text-[13px] leading-6 outline-none focus:ring-2 focus:ring-ring/25" data-testid="input-review-answer"/> : <div className="mb-5 rounded-xl bg-muted/55 p-4 text-[13px] leading-6">{item.answer}</div>}</>}
        {item.kind === 'quiz' && <><label className="mb-2 block text-[10px] font-semibold uppercase tracking-[.12em] text-muted-foreground">Answer / explanation</label>{editing ? <textarea value={answer} onChange={e=>setAnswer(e.target.value)} rows={3} className="mb-5 w-full resize-y rounded-xl border border-input bg-background p-3 text-[13px] leading-6 outline-none focus:ring-2 focus:ring-ring/25" data-testid="input-review-answer"/> : <div className="mb-5 rounded-xl bg-muted/55 p-4 text-[13px] leading-6">{item.answer}</div>}</>}
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <button onClick={approveCurrent} disabled={approve.isPending} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-[12px] font-semibold text-primary-foreground disabled:opacity-50 sm:flex-none" data-testid="button-approve-draft"><Check size={15}/>{approve.isPending ? 'Saving…' : editing ? 'Approve edited draft' : 'Approve as written'}<kbd className="ml-1 hidden rounded border border-primary-foreground/30 px-1.5 py-0.5 text-[9px] opacity-75 sm:inline">A</kbd></button>
          <button onClick={() => setEditing(!editing)} className={`inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-[12px] font-semibold ${editing ? 'border-accent bg-accent/15 text-foreground' : 'border-border bg-background hover:bg-muted'}`} data-testid="button-edit-draft">{editing ? 'Stop editing' : 'Edit'}<kbd className="hidden rounded border border-border px-1.5 py-0.5 text-[9px] text-muted-foreground sm:inline">E</kbd></button>
          <button onClick={() => setDiscardOpen(!discardOpen)} className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-3 text-[12px] font-semibold text-muted-foreground hover:border-destructive/30 hover:text-destructive" data-testid="button-open-discard"><XCircle size={15}/>Discard<kbd className="hidden rounded border border-border px-1.5 py-0.5 text-[9px] sm:inline">D</kbd></button>
        </div>
        {discardOpen && <div className="mt-4 rounded-xl border border-destructive/15 bg-destructive/5 p-4">
          <label className="mb-2 block text-[11px] font-semibold">Why doesn’t this draft work? <span className="font-normal text-muted-foreground">Optional</span></label>
          <select value={reason ?? ''} onChange={e=>setReason((e.target.value || null) as DiscardItemInputReason)} className="w-full rounded-lg border border-border bg-background px-3 py-2.5 text-[12px] outline-none focus:ring-2 focus:ring-ring/25" data-testid="select-discard-reason"><option value="">No reason</option>{reasons.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}</select>
          <div className="mt-3 flex justify-end gap-2"><button onClick={()=>setDiscardOpen(false)} className="rounded-lg px-3 py-2 text-[11px] text-muted-foreground" data-testid="button-cancel-discard">Keep draft</button><button onClick={discardCurrent} disabled={discard.isPending} className="rounded-lg bg-destructive px-3 py-2 text-[11px] font-semibold text-destructive-foreground disabled:opacity-50" data-testid="button-confirm-discard">{discard.isPending ? 'Discarding…' : 'Discard draft'}</button></div>
        </div>}
      </div>
      <div className="flex items-center justify-between rounded-xl bg-muted/55 px-4 py-3 text-[10px] text-muted-foreground lg:col-span-2"><span>Draft {data?.reviewedCount ? data.reviewedCount + 1 : 1} <span className="px-1">·</span> {item.documentName || 'Source document'} / {item.section}</span><span className="hidden items-center gap-2 sm:flex"><kbd className="rounded border border-border bg-card px-1.5 py-1">A</kbd> approve <kbd className="ml-1 rounded border border-border bg-card px-1.5 py-1">E</kbd> edit <kbd className="ml-1 rounded border border-border bg-card px-1.5 py-1">D</kbd> discard</span></div>
    </div>}
  </div>;
}

function LibraryPage() {
  const { data: docs, isLoading: docsLoading } = useListDocuments({ query: { queryKey: getListDocumentsQueryKey() } });
  const [documentId, setDocumentId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [kind, setKind] = useState('');
  const { data: selectedDocument } = useGetDocument(documentId, { query: { queryKey: getGetDocumentQueryKey(documentId), enabled: !!documentId } });
  const params = useMemo(() => ({ ...(documentId ? { documentId } : {}), ...(sectionId ? { sectionId } : {}), ...(kind ? { kind: kind as CardKind } : {}) }), [documentId, sectionId, kind]);
  const { data: cards, isLoading, isError, error, refetch } = useListApprovedCards(params, { query: { queryKey: getListApprovedCardsQueryKey(params) } });
  const sections = selectedDocument?.sections ?? [];
  const resetSection = (value: string) => { setDocumentId(value); setSectionId(''); };
  const updateSection = (value: string) => { setSectionId(value); };
  const list = cards ?? [];
  return <div className="reveal">
    <PageHeading eyebrow="Approved by you" title="Your study library." description="A growing collection of source-linked flashcards and quizzes. Filter down to the exact document and section you want."/>
    <div className="mb-5 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold"><Filter size={14} className="text-primary"/> Narrow your library</div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-[10px] font-medium text-muted-foreground">Document<select value={documentId} disabled={docsLoading} onChange={e=>resetSection(e.target.value)} className="mt-1.5 block w-full rounded-xl border border-input bg-background px-3 py-2.5 text-[12px] text-foreground outline-none focus:ring-2 focus:ring-ring/25" data-testid="select-library-document"><option value="">All documents</option>{(docs ?? []).map(doc=><option key={doc.id} value={doc.id}>{doc.name}</option>)}</select></label>
        <label className="text-[10px] font-medium text-muted-foreground">Section<select value={sectionId} disabled={!documentId || !sections.length} onChange={e=>updateSection(e.target.value)} className="mt-1.5 block w-full rounded-xl border border-input bg-background px-3 py-2.5 text-[12px] text-foreground outline-none focus:ring-2 focus:ring-ring/25 disabled:opacity-50" data-testid="select-library-section"><option value="">All sections</option>{sections.map(section=><option key={section.id} value={section.id}>{section.title}</option>)}</select></label>
        <label className="text-[10px] font-medium text-muted-foreground">Card type<select value={kind} onChange={e=>setKind(e.target.value)} className="mt-1.5 block w-full rounded-xl border border-input bg-background px-3 py-2.5 text-[12px] text-foreground outline-none focus:ring-2 focus:ring-ring/25" data-testid="select-library-kind"><option value="">All card types</option><option value="flashcard">Flashcards</option><option value="quiz">Quizzes</option></select></label>
      </div>
    </div>
    <div className="mb-3 flex items-center justify-between"><div className="serif text-[27px]">{list.length} {list.length === 1 ? 'card' : 'cards'}</div><span className="mono text-[9px] uppercase tracking-[.15em] text-muted-foreground">Approved collection</span></div>
    {isLoading ? <Skeleton lines={4}/> : isError ? <><Notice>{errorMessage(error)}</Notice><button onClick={()=>refetch()} className="rounded-lg border border-border px-4 py-2 text-sm" data-testid="button-retry-library">Try again</button></> : list.length === 0 ?
      <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center"><Library className="mx-auto text-primary/70" size={26}/><h3 className="serif mt-4 text-[27px]">Nothing here just yet.</h3><p className="mx-auto max-w-[390px] text-[12px] leading-5 text-muted-foreground">{documentId || sectionId || kind ? 'No approved cards match those filters. Try a broader selection.' : 'Approved cards will gather here, each with its source attached.'}</p><Link href={documentId ? '/review' : '/'} className="mt-3 inline-flex items-center gap-2 text-[12px] font-semibold text-primary no-underline" data-testid="link-library-next">{documentId ? 'Review waiting drafts' : 'Add a document'} <ArrowRight size={14}/></Link></div> :
      <div className="space-y-3">{list.map((card,index)=><article key={card.id} className="rounded-2xl border border-border bg-card p-5 sm:p-6" data-testid={`approved-card-${card.id}`}>
        <div className="mb-4 flex flex-wrap items-center gap-2"><span className="rounded-full bg-primary/10 px-2.5 py-1 text-[9px] font-medium text-primary">{kindName(card.kind)}</span><span className="text-[10px] text-muted-foreground">{card.documentName}</span><span className="text-muted-foreground">/</span><span className="text-[10px] text-muted-foreground">{card.section}</span><span className="mono ml-auto text-[9px] text-muted-foreground">{card.reviewOutcome === 'edited' ? 'EDITED BY YOU' : 'APPROVED AS WRITTEN'}</span></div>
        <h3 className="serif m-0 text-[24px] leading-tight">{card.front}</h3>
        {card.kind === 'quiz' ? <div className="mt-4 grid gap-2 sm:grid-cols-2">{card.quizOptions.map((option,i)=><div key={i} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] ${option === card.correctAnswer ? 'border-primary/30 bg-primary/5 text-primary' : 'border-border bg-background text-foreground'}`}><span className="mono text-[9px]">{String.fromCharCode(65+i)}</span>{option}{option === card.correctAnswer && <Check size={13} className="ml-auto shrink-0"/>}</div>)}</div> : <div className="mt-3 rounded-xl bg-muted/55 px-4 py-3 text-[12px] leading-6">{card.answer}</div>}
        <div className="mt-4 border-t border-border pt-3"><div className="mono mb-2 text-[9px] uppercase tracking-[.14em] text-muted-foreground">Cited from your notes · {card.sources.length} {card.sources.length === 1 ? 'sentence' : 'sentences'}</div><div className="space-y-2">{card.sources.slice(0,2).map((s,i)=><p key={s.id} className="m-0 border-l-2 border-accent/60 pl-3 text-[11px] leading-5 text-muted-foreground">{s.text}</p>)}</div></div>
      </article>)}</div>}
    <p className="mt-5 text-center text-[10px] text-muted-foreground">Your filters preserve the document and section context exactly as they appear in your notes.</p>
  </div>;
}

function StatsPage() {
  const { data, isLoading, isError, error, refetch } = useGetReviewStats(undefined, { query: { queryKey: getGetReviewStatsQueryKey() } });
  const stats = data;
  const total = (stats?.approvedAsIs ?? 0) + (stats?.edited ?? 0) + (stats?.discarded ?? 0);
  const comparisons = stats?.comparisons ?? [];
  const reasonLabels: Record<string,string> = { added_outside_info: 'Added information outside the source', dropped_a_condition: 'Dropped a condition', merged_unrelated_sentences: 'Merged unrelated sentences', factually_wrong_per_source: 'Factually wrong per source', other: 'Other' };
  return <div className="reveal">
    <PageHeading eyebrow="Your review practice" title="A little more perspective." description="See what you keep, what you reshape, and where drafts need a closer match to the source."/>
    {isLoading ? <Skeleton lines={4}/> : isError ? <><Notice>{errorMessage(error)}</Notice><button onClick={()=>refetch()} className="rounded-lg border border-border px-4 py-2 text-sm" data-testid="button-retry-stats">Try again</button></> : <>
      <section className="mb-7 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatBlock label="Approved as written" value={stats?.approvedAsIs ?? 0} detail="AI draft stayed intact" tone="green"/>
        <StatBlock label="Edited and approved" value={stats?.edited ?? 0} detail="Your words made it truer" tone="sand"/>
        <StatBlock label="Discarded" value={stats?.discarded ?? 0} detail="Didn’t hold up to the source" tone="rose"/>
      </section>
      <div className="grid gap-4 lg:grid-cols-[.82fr_1.18fr]">
        <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
          <div className="mono text-[9px] uppercase tracking-[.17em] text-muted-foreground">The review mix</div><h2 className="serif mb-5 mt-2 text-[27px]">Decisions so far</h2>
          {total === 0 ? <div className="rounded-xl bg-muted/50 p-5 text-[12px] leading-5 text-muted-foreground">Your first review will start to shape this picture. There’s no score to chase—just a clearer guide.</div> : <div>
            <div className="flex h-3 overflow-hidden rounded-full bg-muted"><div className="bg-primary transition-all" style={{ width: `${(stats!.approvedAsIs / total) * 100}%` }}/><div className="bg-accent transition-all" style={{ width: `${(stats!.edited / total) * 100}%` }}/><div className="bg-[#c98783] transition-all" style={{ width: `${(stats!.discarded / total) * 100}%` }}/></div>
            <div className="mt-5 space-y-3">{[{label:'Approved as written',n:stats!.approvedAsIs,color:'bg-primary'},{label:'Edited and approved',n:stats!.edited,color:'bg-accent'},{label:'Discarded',n:stats!.discarded,color:'bg-[#c98783]'}].map(x=><div key={x.label} className="flex items-center gap-2 text-[11px]"><span className={`h-2 w-2 rounded-full ${x.color}`}/><span className="flex-1 text-muted-foreground">{x.label}</span><span className="mono">{x.n}</span><span className="mono w-10 text-right text-muted-foreground">{Math.round(x.n/total*100)}%</span></div>)}</div>
           </div>}
          <div className="mt-7 border-t border-border pt-5"><div className="mono mb-3 text-[9px] uppercase tracking-[.16em] text-muted-foreground">Reasons for discarding</div>{Object.entries(stats?.reasons ?? {}).filter(([,n])=>n>0).length ? <div className="space-y-3">{Object.entries(stats?.reasons ?? {}).filter(([,n])=>n>0).sort((a,b)=>b[1]-a[1]).map(([key,n])=><div key={key} className="flex items-center gap-3 text-[11px]"><span className="flex-1 text-muted-foreground">{reasonLabels[key] ?? key}</span><span className="mono rounded-full bg-muted px-2 py-1 text-[10px]">{n}</span></div>)}</div> : <p className="m-0 text-[11px] text-muted-foreground">No discard reasons recorded.</p>}</div>
        </section>
        <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
          <div className="flex items-center justify-between"><div><div className="mono text-[9px] uppercase tracking-[.17em] text-muted-foreground">Draft vs. final</div><h2 className="serif mb-0 mt-2 text-[27px]">What changed in your hands</h2></div><span className="mono text-[10px] text-muted-foreground">{comparisons.length} comparisons</span></div>
          {!comparisons.length ? <div className="mt-5 rounded-xl bg-muted/50 p-5 text-[12px] leading-5 text-muted-foreground">When you edit and approve a card, its original draft and your final version will be compared here.</div> : <div className="mt-5 space-y-3">{comparisons.map((c,i)=><article key={c.cardId} className="rounded-xl border border-border bg-background p-4" data-testid={`comparison-${c.cardId}`}><div className="mb-3 flex items-center justify-between"><span className="mono text-[9px] uppercase tracking-[.13em] text-primary">Comparison {String(i+1).padStart(2,'0')}</span><span className="text-[9px] text-muted-foreground">{c.documentId} / {c.sectionId}</span></div><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-lg bg-[#f3eee3] p-3"><div className="mono mb-1 text-[8px] uppercase tracking-[.14em] text-[#88795f]">AI original</div><div className="text-[11px] font-semibold leading-5">{c.originalDraft.front}</div><p className="mb-0 mt-1 text-[10px] leading-4 text-[#766e60]">{c.originalDraft.answer}</p></div><div className="rounded-lg bg-primary/5 p-3"><div className="mono mb-1 text-[8px] uppercase tracking-[.14em] text-primary">Your approved version</div><div className="text-[11px] font-semibold leading-5">{c.finalCard.front}</div><p className="mb-0 mt-1 text-[10px] leading-4 text-muted-foreground">{c.finalCard.answer}</p></div></div></article>)}</div>}
        </section>
      </div>
    </>}
  </div>;
}

function StatBlock({ label, value, detail, tone }: { label:string; value:number; detail:string; tone:string }) {
  const tones: Record<string,string> = { green:'border-primary/20 bg-[#eaf0e9]', sand:'border-[#e6d8c2] bg-[#f5efe5]', rose:'border-[#ead2cf] bg-[#f7eeec]' };
  return <div className={`rounded-2xl border p-5 ${tones[tone]}`}><div className="text-[11px] text-muted-foreground">{label}</div><div className="serif mt-4 text-[40px] leading-none">{value}</div><div className="mt-2 text-[10px] text-muted-foreground">{detail}</div></div>;
}

function Router() {
  return <Switch>
    <Route path="/" component={Dashboard}/>
    <Route path="/documents/:id" component={DocumentPage}/>
    <Route path="/review" component={ReviewPage}/>
    <Route path="/library" component={LibraryPage}/>
    <Route path="/stats" component={StatsPage}/>
    <Route><NotFound/></Route>
  </Switch>;
}

function Root() {
  const auth = useAuth();
  const [path] = useLocation();
  if (auth.isLoading) {
    return <div className="flex min-h-[100dvh] items-center justify-center bg-background px-6 text-sm text-muted-foreground">Opening your private study space…</div>;
  }
  if (!auth.isAuthenticated) {
    return <SignInPage onSignIn={auth.login}/>;
  }
  return <AppShell auth={auth}><Router key={path}/></AppShell>;
}

function SignInPage({ onSignIn }: { onSignIn: () => void }) {
  return <main className="paper-grain flex min-h-[100dvh] items-center justify-center bg-background px-5 py-12 sm:px-8">
    <section className="w-full max-w-[560px] rounded-[28px] border border-border bg-card p-7 shadow-sm sm:p-10" data-testid="sign-in-screen">
      <div className="mb-9 flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-[15px] bg-primary text-primary-foreground"><BookOpen size={20} strokeWidth={1.8}/></span>
        <span><span className="serif block text-[23px] leading-[.92]">Living Study</span><span className="serif text-[23px] leading-[.92] italic">Guide</span></span>
      </div>
      <div className="mono mb-3 text-[10px] uppercase tracking-[.18em] text-primary">Your notes stay yours</div>
      <h1 className="serif m-0 max-w-[440px] text-[clamp(36px,8vw,54px)] leading-[1.04]">A quieter way to study what you know.</h1>
      <p className="mt-4 max-w-[440px] text-[14px] leading-6 text-muted-foreground">Sign in to keep your PDFs private, review every AI-made card against its source, and build a library that belongs to you.</p>
      <button onClick={onSignIn} className="mt-7 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 sm:w-auto" data-testid="button-sign-in">
        <LogIn size={16}/> Sign in to continue
      </button>
      <div className="mt-8 grid gap-3 border-t border-border pt-5 sm:grid-cols-3">
        {[["Private PDFs", "Only you can open your notes."], ["Source-linked cards", "Every draft cites its sentences."], ["Your approval", "Nothing joins the library early."]].map(([title, detail]) =>
          <div key={title} className="rounded-xl bg-muted/50 p-3">
            <div className="text-[11px] font-semibold">{title}</div>
            <div className="mt-1 text-[10px] leading-4 text-muted-foreground">{detail}</div>
          </div>,
        )}
      </div>
    </section>
  </main>;
}

function App() {
  return <QueryClientProvider client={queryClient}><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Root/></WouterRouter></QueryClientProvider>;
}

export default App;
