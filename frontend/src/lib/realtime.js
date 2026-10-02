// Live updates from Supabase Realtime, exposed with the same on/off/emit
// interface the pages used with Socket.IO, and the same event names:
//   new-order, order-updated, my-order-updated, bill-requested,
//   table-occupied, table-freed, notification
import { supabase } from './supabase';

const orderJson = async (id) => {
    const { data } = await supabase.rpc('get_order', { p_id: id });
    return data;
};

export function createRealtimeSocket() {
    const listeners = new Map();

    const emit = (event, payload) => {
        (listeners.get(event) || []).slice().forEach(fn => fn(payload));
    };

    const channel = supabase
        .channel(`live-${Math.random().toString(36).slice(2)}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, async ({ new: row }) => {
            const order = await orderJson(row.id);
            if (order) emit('new-order', order);
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, async ({ new: row, old }) => {
            const order = await orderJson(row.id);
            if (!order) return;
            emit('order-updated', order);
            emit('my-order-updated', order);
            if (row.status === 'bill_requested' && old?.status !== 'bill_requested') {
                emit('bill-requested', order);
            }
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notification_events' }, ({ new: row }) => {
            if (row) emit('notification', row);
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'dining_tables' }, ({ new: row }) => {
            if (!row) return;
            emit(row.status === 'available' ? 'table-freed' : 'table-occupied', { ...row, _id: row.id, tableNumber: row.table_number });
        })
        .subscribe();

    return {
        on(event, fn) {
            listeners.set(event, [...(listeners.get(event) || []), fn]);
        },
        // Like Socket.IO: off(event) removes every listener, off(event, fn) just that one
        off(event, fn) {
            if (!fn) listeners.delete(event);
            else listeners.set(event, (listeners.get(event) || []).filter(f => f !== fn));
        },
        // Rooms are handled by row level security now; kept so old calls are harmless
        emit() { },
        close() {
            listeners.clear();
            supabase.removeChannel(channel);
        },
    };
}
