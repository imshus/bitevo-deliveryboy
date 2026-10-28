// Sign-in: the mobile number the BiteVo manager registered, then the 6-digit code sent to it.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { useSession } from '../session.jsx';
import { Spinner } from '../components/ui.jsx';

export default function Login() {
  const { setAgent, config } = useSession();
  const [step, setStep] = useState('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [wait, setWait] = useState(0);
  const codeBox = useRef(null);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait(w => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const sendCode = async e => {
    e?.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await api.sendCode(phone);
      setDevCode(r.devCode || null);
      setWait(r.resendAfterSecs || 30);
      setStep('code');
      setCode('');
      setTimeout(() => codeBox.current?.focus(), 50);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const verify = async e => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await api.verify(phone, code);
      setAgent(r.agent);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const digits = phone.replace(/\D/g, '');

  return (
    <main className="login">
      <div className="login__brand">
        <img src="/assets/logo-320.webp" alt="BiteVo" width="160" height="66" />
        <span className="login__badge">Delivery Partner</span>
      </div>

      {step === 'phone' ? (
        <form className="login__card" onSubmit={sendCode}>
          <h1>Sign in to start delivering</h1>
          <p className="muted">Use the mobile number your BiteVo manager registered for you.</p>
          <label className="field">
            <span className="field__label">Mobile number</span>
            <span className="phone-input">
              <span>+91</span>
              <input type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="98765 43210" maxLength={14}
                value={phone} onChange={e => setPhone(e.target.value.replace(/[^\d\s]/g, ''))} autoFocus />
            </span>
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn btn--primary btn--block" disabled={busy || digits.length < 10}>{busy ? <Spinner /> : 'Send code'}</button>
        </form>
      ) : (
        <form className="login__card" onSubmit={verify}>
          <h1>Enter the 6-digit code</h1>
          <p className="muted">
            Sent to +91 {digits.slice(-10, -5)} {digits.slice(-5)} on WhatsApp or SMS.{' '}
            <button type="button" className="link" onClick={() => { setStep('phone'); setError(''); }}>Change number</button>
          </p>
          {devCode && (
            <p className="dev-note">Test mode (OTP_DEV_MODE): your code is <b>{devCode}</b></p>
          )}
          <input ref={codeBox} className="code-input" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
            placeholder="••••••" aria-label="Sign-in code" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} />
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="btn btn--primary btn--block" disabled={busy || code.length !== 6}>{busy ? <Spinner /> : 'Verify and sign in'}</button>
          <button type="button" className="btn btn--ghost btn--block" disabled={busy || wait > 0} onClick={sendCode}>
            {wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}
          </button>
        </form>
      )}

      <p className="login__foot muted">
        Not registered yet? Ask your BiteVo manager to add you as a delivery agent.
        {config.supportPhone && <> Help: <a href={`tel:${config.supportPhone.replace(/[^\d+]/g, '')}`}>{config.supportPhone}</a></>}
      </p>
    </main>
  );
}
