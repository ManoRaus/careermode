import * as webpush from "jsr:@negrel/webpush@0.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";

function localClock(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
}

Deno.serve(async (request) => {
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (request.method !== "POST" || !cronSecret ||
      request.headers.get("Authorization") !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const exportedVapidKeys = JSON.parse(Deno.env.get("VAPID_KEYS_JWK")!);
  const vapidKeys = await webpush.importVapidKeys(exportedVapidKeys);
  const appServer = await webpush.ApplicationServer.new({
    contactInformation: Deno.env.get("VAPID_SUBJECT") || "mailto:admin@careermode.app",
    vapidKeys,
  });

  const { data: schedules, error } = await admin.from("notification_schedules")
    .select("id,user_id,source_id,title,body,local_time,time_zone,app_url,last_sent_date").eq("enabled", true);
  if (error) return Response.json({ error: "Could not load schedules" }, { status: 500 });

  const now = new Date();
  let sent = 0;
  let failed = 0;
  for (const schedule of schedules || []) {
    let clock;
    try { clock = localClock(now, schedule.time_zone || "America/Sao_Paulo"); }
    catch (_) { continue; }
    if (clock.time !== String(schedule.local_time).slice(0, 5) || schedule.last_sent_date === clock.date) continue;

    const { data: subscriptions, error: subError } = await admin.from("push_subscriptions")
      .select("id,endpoint,p256dh,auth").eq("user_id", schedule.user_id);
    if (subError) { failed++; continue; }

    let delivered = false;
    for (const sub of subscriptions || []) {
      try {
        const subscriber = appServer.subscribe({
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        });
        await subscriber.pushTextMessage(JSON.stringify({
          title: schedule.title,
          body: schedule.body,
          tag: schedule.source_id,
          url: schedule.app_url || "/",
        }), { ttl: 3600, urgency: webpush.Urgency.High });
        delivered = true;
        sent++;
      } catch (error) {
        if (error instanceof webpush.PushMessageError && error.isGone()) {
          await admin.from("push_subscriptions").delete().eq("id", sub.id);
        } else {
          console.error("Push delivery error", error);
          failed++;
        }
      }
    }
    if (delivered) await admin.from("notification_schedules")
      .update({ last_sent_date: clock.date, updated_at: new Date().toISOString() }).eq("id", schedule.id);
  }
  return Response.json({ ok: true, sent, failed });
});
