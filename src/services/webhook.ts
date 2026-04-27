export interface WebhookPayload {
  type: 'daily_summary' | 'failure_alert';
  timestamp: string;
  data: Record<string, any>;
}

export async function sendNotification(
  payload: WebhookPayload,
  webhookUrl: string
): Promise<void> {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error(`[webhook] Failed to send notification: ${response.status} ${response.statusText}`);
    } else {
      console.log(`[webhook] Notification sent: ${payload.type}`);
    }
  } catch (err) {
    // Fire-and-forget — webhook failure should never block pipeline
    console.error('[webhook] Error sending notification:', err);
  }
}

export function buildDailySummary(stats: {
  processedToday: number;
  sentToday: number;
  readyToSend: number;
  failedToday: number;
  totalFailed: number;
}): WebhookPayload {
  return {
    type: 'daily_summary',
    timestamp: new Date().toISOString(),
    data: {
      processed_today: stats.processedToday,
      sent_to_ghl_today: stats.sentToday,
      queue_ready_to_send: stats.readyToSend,
      failures_today: stats.failedToday,
      total_unresolved_failures: stats.totalFailed,
      action_needed: stats.totalFailed > 0
        ? `${stats.totalFailed} failed records need attention`
        : 'All clear',
    },
  };
}
