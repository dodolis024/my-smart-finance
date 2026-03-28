import { supabase } from '@/lib/supabase';

export function notifySplit(payload) {
  supabase.functions.invoke('send-split-notification', { body: payload }).catch(() => {});
}
