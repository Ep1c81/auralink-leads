'use client';
import { useState } from 'react';
import {useRouter} from 'next/navigation';
export default function Login() {
  const router=useRouter();
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  async function submit(action: string) {
    if (busy) return; setBusy(true); setMessage('');
    try {
      const res = await fetch('/api/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, email, password }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (action === 'login') router.push('/'); else setMessage(data.message);
    } catch (e) { setMessage(e instanceof Error ? e.message : 'No se pudo conectar.'); } finally { setBusy(false); }
  }
  return <main className="mx-auto w-full max-w-md p-6"><h1 className="text-2xl font-bold">Ingresá a Auralink Leads</h1><p className="my-4">Acceso exclusivo para operadores invitados.</p><form className="flex flex-col gap-4" onSubmit={e => { e.preventDefault(); void submit('login'); }}><label>Correo<input className="block w-full border rounded p-2" type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></label><label>Contraseña<input className="block w-full border rounded p-2" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label><button className="rounded bg-blue-700 p-3 text-white" disabled={busy}>Entrar</button><button type="button" disabled={busy || !email} onClick={() => void submit('link')}>Recibir un enlace de acceso por correo</button><p role="status">{message}</p></form></main>;
}
