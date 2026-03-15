/**
 * Background job poller.
 * Checks pending Telegram jobs against RunPod, delivers results to chats.
 */

import { Api } from "grammy";
import { InputFile } from "grammy";
import { JOB_POLL_INTERVAL_MS } from "../config.js";
import { getPendingJobs, completeJob, refundCredits } from "../db.js";
import { pollJob, resolveOutputUrl, downloadOutput } from "./runpod.js";

let polling = false;

export function startJobPoller(api: Api) {
  console.log(`[poller] Starting job poller (interval: ${JOB_POLL_INTERVAL_MS}ms)`);

  setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      await pollPendingJobs(api);
    } catch (err: any) {
      console.error("[poller] Error:", err.message);
    } finally {
      polling = false;
    }
  }, JOB_POLL_INTERVAL_MS);
}

async function pollPendingJobs(api: Api) {
  const jobs = await getPendingJobs();
  if (jobs.length === 0) return;

  console.log(`[poller] Checking ${jobs.length} pending job(s)`);

  for (const job of jobs) {
    try {
      const result = await pollJob(job.endpoint_id, job.runpod_job_id);

      if (result.status === "IN_QUEUE" || result.status === "IN_PROGRESS") {
        continue;
      }

      if (result.status === "COMPLETED") {
        const url = resolveOutputUrl(result.output);
        if (!url) {
          console.warn(`[poller] Job ${job.id} completed but no output URL`);
          await completeJob(job.id, "failed");
          await refundCredits(job.telegram_user_id, job.linked_user_id, job.credits_used);
          await api.editMessageText(job.chat_id, job.message_id, "Generation completed but no output was produced. Credits refunded.");
          continue;
        }

        const { buffer, mimeType } = await downloadOutput(url);
        const inputFile = new InputFile(buffer, job.output_type === "video" ? "gltch.mp4" : "gltch.png");

        if (job.output_type === "video") {
          await api.sendVideo(job.chat_id, inputFile, {
            reply_to_message_id: job.message_id,
            caption: "\u26A1 Your GLTCH video is ready!",
          });
        } else {
          await api.sendPhoto(job.chat_id, inputFile, {
            reply_to_message_id: job.message_id,
            caption: "\u26A1 Your GLTCH edit is ready!",
          });
        }

        await completeJob(job.id, "completed");
        await api.editMessageText(job.chat_id, job.message_id, "\u2705 Done!").catch(() => {});

      } else {
        // FAILED, CANCELLED, TIMED_OUT
        console.warn(`[poller] Job ${job.id} ended with status: ${result.status}`);
        await completeJob(job.id, "failed");
        await refundCredits(job.telegram_user_id, job.linked_user_id, job.credits_used);

        const reason = result.error?.slice(0, 200) || result.status;
        await api.editMessageText(
          job.chat_id,
          job.message_id,
          `Generation failed (${reason}). Credits have been refunded.`,
        ).catch(() => {});
      }
    } catch (err: any) {
      console.error(`[poller] Error processing job ${job.id}:`, err.message);
    }
  }
}
