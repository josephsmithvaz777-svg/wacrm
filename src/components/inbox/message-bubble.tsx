"use client";

import { cn } from "@/lib/utils";
import type { Message, MessageReaction } from "@/types";
import {
  Clock,
  Check,
  CheckCheck,
  XCircle,
  MapPin,
  LayoutTemplate,
  CornerDownLeft,
  Sparkles,
} from "lucide-react";
import { format } from "date-fns";
import { ReplyQuote } from "./reply-quote";
import { MessageReactions } from "./message-reactions";
import {
  MediaAudioBubble,
  MediaDocumentBubble,
  MediaImageBubble,
  MediaUnavailable,
  MediaVideoBubble,
} from "./message-media";
import { InteractivePreview } from "@/components/interactive/interactive-preview";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useMediaBlobUrl } from "@/hooks/use-media-blob-url";
import { readStoredAdContext, type MessageAdContext } from "@/lib/whatsapp/ad-context";

interface MessageBubbleProps {
  message: Message;
  /** Pre-computed quote info for messages that reply to another. */
  reply?: { authorLabel: string; preview: string } | null;
  reactions?: MessageReaction[];
  currentUserId?: string;
  onToggleReaction?: (emoji: string) => void;
  /**
   * Opens the thread's media viewer on this message. Only images and videos
   * call it; omitted when the parent renders no viewer, in which case media
   * stays inline and non-clickable.
   */
  onOpenMedia?: (messageId: string) => void;
}

function StatusIcon({ status }: { status: Message["status"] }) {
  switch (status) {
    case "sending":
      return <Clock className="h-3 w-3 text-muted-foreground" />;
    case "sent":
      return <Check className="h-3 w-3 text-muted-foreground" />;
    case "delivered":
      return <CheckCheck className="h-3 w-3 text-muted-foreground" />;
    case "read":
      return <CheckCheck className="h-3 w-3 text-blue-400" />;
    case "failed":
      return <XCircle className="h-3 w-3 text-red-400" />;
    default:
      return null;
  }
}

function MessageContent({
  message,
  t,
  onOpenMedia,
}: {
  message: Message;
  t: ReturnType<typeof useTranslations>;
  onOpenMedia?: (messageId: string) => void;
}) {
  // Passed to the media bubbles as a no-arg callback; `undefined` when the
  // parent wired up no viewer, which is what makes them non-clickable.
  const openMedia = onOpenMedia ? () => onOpenMedia(message.id) : undefined;

  switch (message.content_type) {
    case "text":
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text}
        </p>
      );

    case "image":
      return (
        <div>
          {message.media_url ? (
            <MediaImageBubble message={message} onOpen={openMedia} t={t} />
          ) : (
            <MediaUnavailable label={t("photo")} t={t} />
          )}
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "video":
      return (
        <div>
          {message.media_url ? (
            <MediaVideoBubble message={message} onOpen={openMedia} t={t} />
          ) : (
            <MediaUnavailable label={t("video")} t={t} />
          )}
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "audio":
      return (
        <div>
          {message.media_url ? (
            <MediaAudioBubble message={message} t={t} />
          ) : (
            <MediaUnavailable label={t("audio")} t={t} />
          )}
        </div>
      );

    case "document":
      if (!message.media_url) {
        return <MediaUnavailable label={message.content_text || t("document")} t={t} />;
      }
      return <MediaDocumentBubble message={message} t={t} />;

    case "template":
      return (
        <div>
          <span className="mb-1 inline-flex items-center gap-1 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            <LayoutTemplate className="h-3 w-3" />
            {t("template")}
          </span>
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "location":
      return (
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>{message.content_text || t("locationShared")}</span>
        </div>
      );

    case "interactive": {
      // Three cases share content_type='interactive':
      //  - OUTBOUND with payload (composer / automation / Flow send after
      //    migration 035): render the buttons/list as they appear on the phone.
      //  - INBOUND tap (customer chose an option, sender_type='customer'):
      //    no payload; show the tapped option's title with a reply affordance
      //    so agents can tell it's a tap, not the customer typing.
      //  - OUTBOUND with NO payload (legacy bot/Flow sends from before
      //    migration 035 backfilled the column): show the body text plainly —
      //    it is our own message, NOT a customer tap.
      if (message.interactive_payload) {
        return <InteractivePreview payload={message.interactive_payload} />;
      }
      if (message.sender_type === "customer") {
        return (
          <div className="flex flex-col gap-0.5">
            <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <CornerDownLeft className="h-3 w-3" />
              {t("buttonReply")}
            </span>
            <p className="whitespace-pre-wrap break-words text-sm">
              {message.content_text || t("interactiveReply")}
            </p>
          </div>
        );
      }
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text || t("interactiveReply")}
        </p>
      );
    }

    default:
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text || t("unsupported")}
        </p>
      );
  }
}

function adLabel(
  source: MessageAdContext["source"],
  t: ReturnType<typeof useTranslations>,
): string {
  if (source === "instagram_ad") return t("instagramAd");
  if (source === "ad") return t("genericAd");
  return t("facebookAd");
}

function AdContextCard({
  ad,
  t,
  onPrimary,
  flushTop,
}: {
  ad: MessageAdContext;
  t: ReturnType<typeof useTranslations>;
  onPrimary: boolean;
  flushTop: boolean;
}) {
  const { src, status } = useMediaBlobUrl(ad.image_url ?? undefined);
  const [broken, setBroken] = useState(false);
  const showImage = Boolean(ad.image_url) && !broken && status === "ready" && src;
  const muted = onPrimary ? "text-primary-foreground/70" : "text-muted-foreground";
  const href =
    ad.source_url && /^https?:\/\//i.test(ad.source_url) ? ad.source_url : null;

  return (
    <div
      className={cn(
        "-mx-3 mb-2 overflow-hidden",
        flushTop ? "-mt-2 rounded-t-2xl" : "rounded-lg",
      )}
    >
      {showImage && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={t("adImageAlt")}
          className="max-h-52 w-full min-w-[200px] object-cover"
          onError={() => setBroken(true)}
        />
      )}
      <div
        className={cn(
          "px-3 py-2",
          onPrimary ? "bg-primary-foreground/10" : "bg-background/60",
        )}
      >
        <p className={cn("text-[11px] font-medium leading-none", muted)}>
          {adLabel(ad.source, t)}
        </p>
        {ad.headline && (
          <p className="mt-1.5 text-sm font-semibold leading-snug">{ad.headline}</p>
        )}
        {ad.body && (
          <p className={cn("mt-0.5 line-clamp-3 text-xs leading-snug", muted)}>
            {ad.body}
          </p>
        )}
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "mt-1 block truncate text-[11px] underline underline-offset-2",
              muted,
            )}
          >
            {href.replace(/^https?:\/\//i, "")}
          </a>
        )}
      </div>
    </div>
  );
}

export function MessageBubble({
  message,
  reply,
  reactions,
  currentUserId,
  onToggleReaction,
  onOpenMedia,
}: MessageBubbleProps) {
  const t = useTranslations("Inbox.bubble");

  const isAgent = message.sender_type === "agent" || message.sender_type === "bot";
  const time = format(new Date(message.created_at), "HH:mm");
  const ad = readStoredAdContext(message.ad_context);

  // Row alignment + width cap are owned by <MessageActions> so its hover
  // group matches the bubble's content area, not the full row.
  return (
    <div
      className={cn(
        "flex flex-col",
        isAgent ? "items-end" : "items-start",
      )}
    >
      <div
        className={cn(
          "relative rounded-2xl px-3 py-2",
          isAgent
            ? "rounded-br-md bg-primary text-primary-foreground"
            : "rounded-bl-md bg-muted text-foreground",
        )}
      >
        {reply && (
          <ReplyQuote
            authorLabel={reply.authorLabel}
            preview={reply.preview}
            onPrimary={isAgent}
          />
        )}
        {ad && (
          <AdContextCard ad={ad} t={t} onPrimary={isAgent} flushTop={!reply} />
        )}
        <MessageContent message={message} t={t} onOpenMedia={onOpenMedia} />
        <div
          className={cn(
            "mt-1 flex items-center gap-1",
            isAgent ? "justify-end" : "justify-start",
          )}
        >
          {/* AI badge — only on replies the auto-reply bot generated
              (always outbound, so it sits on the primary fill). Lets
              agents tell an AI reply from their own / a Flow's at a
              glance. */}
          {message.ai_generated && (
            <span
              className="inline-flex items-center gap-0.5 rounded-full bg-primary-foreground/20 px-1.5 py-px text-[9px] font-semibold uppercase leading-none tracking-wide text-primary-foreground"
              title={t("aiBadgeTitle")}
            >
              <Sparkles className="h-2.5 w-2.5" />
              {t("aiBadge")}
            </span>
          )}
          <span
            className={cn(
              "text-[10px]",
              // Outbound bubbles sit on the primary fill, so the
              // timestamp must read against that (not the neutral
              // foreground) — otherwise it goes low-contrast in light
              // mode. Inbound bubbles use the muted surface.
              isAgent ? "text-primary-foreground/70" : "text-muted-foreground",
            )}
          >
            {time}
          </span>
          {isAgent && <StatusIcon status={message.status} />}
        </div>
      </div>
      {reactions && reactions.length > 0 && onToggleReaction && (
        <MessageReactions
          reactions={reactions}
          currentUserId={currentUserId}
          onToggle={onToggleReaction}
        />
      )}
    </div>
  );
}
