// Offline outbox: counter/kiosk sales, payouts and expenses are saved on the device and sent
// in order when the internet is back. Every job carries a client id, so the database stores
// it once even if it is sent twice.
import { useEffect, useState } from 'react';
import { supabase } from './supabase';

const KEY = 'cafe-outbox-v1';
const listeners = new Set();
let flushing = false;

const read = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || { jobs: [], failed: [] }; } catch { return { jobs: [], failed: [] }; }
};
const write = (state) => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ }
    listeners.forEach(fn => fn(state));
};

export const newClientId = () =>
    (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);

const isNetworkError = (error) =>
    !error?.code && /fetch|network|load failed|timeout/i.test(error?.message || '');

// Add a job (a database function call) and try to send it straight away
export function enqueue(fn, args, label) {
    const state = read();
    const job = { id: newClientId(), fn, args, label, createdAt: new Date().toISOString() };
    state.jobs.push(job);
    write(state);
    flush();
    return job.id;
}

// Run now if online, otherwise queue. Resolves with the result, or { queued: true } when offline.
export async function runOrQueue(fn, args, label) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
        enqueue(fn, args, label);
        return { queued: true };
    }
    const { data, error } = await supabase.rpc(fn, args);
    if (error && isNetworkError(error)) {
        enqueue(fn, args, label);
        return { queued: true };
    }
    if (error) throw new Error(error.message);
    return { data };
}

export async function flush() {
    if (flushing || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
    flushing = true;
    try {
        for (;;) {
            const state = read();
            const job = state.jobs[0];
            if (!job) break;
            const { error } = await supabase.rpc(job.fn, job.args);
            if (error && isNetworkError(error)) break;
            const next = read();
            next.jobs = next.jobs.filter(j => j.id !== job.id);
            if (error) next.failed.push({ ...job, error: error.message, failedAt: new Date().toISOString() });
            write(next);
        }
    } finally {
        flushing = false;
    }
}

export function retryFailed(id) {
    const state = read();
    const job = state.failed.find(j => j.id === id);
    if (!job) return;
    state.failed = state.failed.filter(j => j.id !== id);
    state.jobs.push({ ...job, error: undefined });
    write(state);
    flush();
}

export function dismissFailed(id) {
    const state = read();
    state.failed = state.failed.filter(j => j.id !== id);
    write(state);
}

if (typeof window !== 'undefined') {
    window.addEventListener('online', () => flush());
    setInterval(() => { if (read().jobs.length) flush(); }, 15000);
}

// { online, pending, failed } for the status pill
export function useOutbox() {
    const [state, setState] = useState(read);
    const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
    useEffect(() => {
        const on = () => setOnline(true);
        const off = () => setOnline(false);
        listeners.add(setState);
        window.addEventListener('online', on);
        window.addEventListener('offline', off);
        flush();
        return () => {
            listeners.delete(setState);
            window.removeEventListener('online', on);
            window.removeEventListener('offline', off);
        };
    }, []);
    return { online, pending: state.jobs, failed: state.failed };
}
