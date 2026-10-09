import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Check, Eye, EyeOff, LockKeyhole, ShoppingBag, Sparkles } from 'lucide-react';
import { client } from '../lib/api';
import { useToast } from '../lib/hooks';
import { Button, Field } from '../components/ui';
import { Logo } from '../components/Layout';

export default function Auth() {
  const [register, setRegister] = useState(false), [showPassword, setShowPassword] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState(''), [slug, setSlug] = useState('');
  const navigate = useNavigate(), toast = useToast();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError('');
    const form = new FormData(event.currentTarget);
    const body: Record<string, unknown> = { email: form.get('email'), password: form.get('password') };
    if (register) Object.assign(body, { name: form.get('name'), storeName: form.get('storeName'), storeSlug: slug, currency: form.get('currency') });
    try { await client.authenticate(register ? 'register' : 'login', body); toast(register ? 'Your workspace is ready. Welcome aboard!' : 'Welcome back.'); navigate('/'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to sign in.'); }
    finally { setPending(false); }
  }
  return <div className="auth-page"><section className="auth-story"><Logo /><div className="auth-story-content"><div className="auth-tag"><Sparkles size={14} /> A little clarity. A lot of possibility.</div><h1>Good things<br />are in <em>store.</em></h1><p>Your products, your people, your next big move.<br />One thoughtfully designed workspace.</p>
    <div className="auth-illustration"><div className="auth-mini-card"><span className="auth-mini-icon"><ShoppingBag size={23} /></span><span>YOUR BUSINESS, IN FOCUS</span><strong>Everything. Connected.</strong><div className="auth-bars">{[35, 56, 43, 68, 60, 81, 72, 92, 86, 100].map((h, i) => <span key={i} style={{ height: `${h}%` }} />)}</div><div className="auth-mini-footer"><span><Check size={13} /> Products organized</span><span><Check size={13} /> Team in sync</span></div></div><span className="auth-floating"><span className="status-dot" /> Your next chapter starts here.</span></div>
    <div className="auth-benefits">{['Less busywork, more business', 'Your store. Your team. Your rules.', 'Built to grow alongside you'].map((t) => <span key={t}><Check size={15} />{t}</span>)}</div></div><span className="auth-copyright">STORELY · COMMERCE, CONSIDERED.</span></section>
    <section className="auth-form-section"><Link to="/" className="auth-back">← Explore the workspace</Link><div className="auth-form-wrap"><span className="auth-form-icon"><ShoppingBag size={25} /></span><h2>{register ? 'Meet your new workspace.' : 'Make yourself at home.'}</h2><p>{register ? 'Create your account and bring your store to life.' : 'Sign in to pick up where you left off.'}</p><div className="auth-tabs"><button className={!register ? 'active' : ''} onClick={() => { setRegister(false); setError(''); }}>Sign in</button><button className={register ? 'active' : ''} onClick={() => { setRegister(true); setError(''); }}>Create account</button></div>
      <form onSubmit={submit} className="auth-form">{register ? <Field label="Your name"><input name="name" autoComplete="name" placeholder="Alex Morgan" required maxLength={100} /></Field> : null}
        <Field label="Email address"><input name="email" type="email" autoComplete="email" placeholder="you@yourstore.com" required maxLength={254} /></Field>
        <Field label="Password" hint={register ? 'At least 12 characters. Make it something only you know.' : undefined}><div className="password-input"><input name="password" type={showPassword ? 'text' : 'password'} autoComplete={register ? 'new-password' : 'current-password'} required minLength={register ? 12 : 1} maxLength={128} placeholder="Enter your password" /><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></Field>
        {register ? <><Field label="Store name"><input name="storeName" required maxLength={100} placeholder="Studio Store" onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60))} /></Field><div className="form-grid"><Field label="Store URL" hint="A unique lowercase name."><input name="storeSlug" value={slug} onChange={(e) => setSlug(e.target.value)} required minLength={3} maxLength={60} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" /></Field><Field label="Currency"><select name="currency" defaultValue="USD">{['USD', 'EUR', 'GBP', 'EGP'].map((v) => <option key={v}>{v}</option>)}</select></Field></div></> : null}
        {error ? <p className="inline-error" role="alert">{error}</p> : null}<Button disabled={pending} type="submit">{pending ? 'Opening your workspace…' : register ? 'Create workspace' : 'Sign in to your workspace'}<ArrowRight size={17} /></Button>
      </form><div className="auth-or"><span />or take a look around<span /></div><Button variant="secondary" className="demo-auth-button" onClick={() => { client.useDemo(); navigate('/'); }}>Explore the interactive demo <Sparkles size={16} /></Button><p className="auth-security"><LockKeyhole size={13} /> Secure sessions. A workspace that’s yours.</p>
    </div><span className="auth-support">Need a hand? See the getting-started guide in the demo.</span></section></div>;
}
