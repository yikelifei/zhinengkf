import {
  ContactRound,
  Download,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  LayoutGrid,
  Link2,
  MapPin,
  Paperclip,
  ShoppingBag,
  Video,
  Volume2,
} from "lucide-react";
import type { ConversationWorkbenchAttachment } from "./types";
import type { ConversationWorkbenchContent } from "./conversation-timeline-types";
import styles from "./conversation-timeline-content.module.css";

export function ConversationTimelineAttachment({ attachment }: { attachment: ConversationWorkbenchAttachment }) {
  if (attachment.previewUrl) {
    return (
      <a className={styles.imageAttachment} href={attachment.href || attachment.previewUrl} target="_blank" rel="noreferrer" aria-label={`查看图片 ${attachment.name}`}>
        <img src={attachment.previewUrl} alt={attachment.name} loading="lazy" />
      </a>
    );
  }
  if (attachment.kind === "voice") {
    return (
      <div className={styles.voiceAttachment} aria-label={`语音消息 ${attachment.name}`}>
        <Volume2 size={20} aria-hidden="true" />
        {attachment.href ? <audio controls preload="metadata" src={attachment.href}>当前浏览器无法播放这条语音。</audio> : <span>语音消息暂不可播放</span>}
      </div>
    );
  }
  if (attachment.kind === "video") {
    return attachment.href ? (
      <video className={styles.videoAttachment} controls preload="metadata" src={attachment.href} aria-label={`视频消息 ${attachment.name}`}>
        当前浏览器无法播放这段视频。
      </video>
    ) : <div className={styles.unavailableAttachment}><Video size={19} aria-hidden="true" /><span>视频消息暂不可播放</span></div>;
  }
  const fileContent = (
    <>
      <span className={styles.fileAttachmentIcon}>{attachment.kind === "image" ? <ImageIcon size={24} aria-hidden="true" /> : <FileText size={24} aria-hidden="true" />}</span>
      <span className={styles.fileAttachmentCopy}>
        <b>{attachment.name}</b>
        <small>{attachment.sizeLabel || attachment.detail || "文件"}</small>
      </span>
      {attachment.href ? <Download size={17} aria-hidden="true" /> : <Paperclip size={17} aria-hidden="true" />}
    </>
  );
  return attachment.href ? (
    <a className={styles.fileAttachment} href={attachment.href} target="_blank" rel="noreferrer" aria-label={`打开文件 ${attachment.name}`}>{fileContent}</a>
  ) : <div className={`${styles.fileAttachment} ${styles.fileAttachmentUnavailable}`}>{fileContent}</div>;
}

export function ConversationTimelineStructuredContent({ content }: { content: ConversationWorkbenchContent }) {
  if (content.type === "location") {
    const mapUrl = locationMapUrl(content);
    const body = (
      <>
        <span className={styles.structuredIcon}><MapPin size={24} aria-hidden="true" /></span>
        <span><b>{content.name || "位置"}</b><small>{content.address || "客户分享了一个位置"}</small></span>
        {mapUrl ? <ExternalLink size={15} aria-hidden="true" /> : null}
      </>
    );
    return mapUrl
      ? <a className={styles.locationCard} href={mapUrl} target="_blank" rel="noreferrer" aria-label={`在地图中查看 ${content.name || "位置"}`}>{body}</a>
      : <div className={styles.locationCard}>{body}</div>;
  }
  if (content.type === "link") {
    const body = (
      <>
        <span className={styles.cardCopy}><b>{content.title || "网页链接"}</b>{content.description ? <small>{content.description}</small> : null}</span>
        {content.imageUrl ? <img src={content.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className={styles.structuredIcon}><Link2 size={23} aria-hidden="true" /></span>}
      </>
    );
    return content.url
      ? <a className={styles.linkCard} href={content.url} target="_blank" rel="noreferrer" aria-label={`打开链接 ${content.title || "网页链接"}`}>{body}</a>
      : <div className={styles.linkCard}>{body}</div>;
  }
  if (content.type === "business_card") {
    return <div className={styles.contactCard}><span className={styles.contactAvatar}><ContactRound size={28} aria-hidden="true" /></span><span><b>个人名片</b><small>{content.userId || "企业微信联系人"}</small></span></div>;
  }
  if (content.type === "miniprogram") {
    return <div className={styles.miniProgramCard}><small><LayoutGrid size={12} aria-hidden="true" /> 小程序</small><b>{content.title || "微信小程序"}</b><span>请在微信中打开</span></div>;
  }
  if (content.type === "product") {
    const body = (
      <>
        {content.imageUrl ? <img src={content.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className={styles.productPlaceholder}><ShoppingBag size={26} aria-hidden="true" /></span>}
        <span className={styles.cardCopy}><b>{content.title || "商品"}</b>{content.description ? <small>{content.description}</small> : null}{content.price ? <em>{content.price}</em> : null}</span>
      </>
    );
    return content.url
      ? <a className={styles.productCard} href={content.url} target="_blank" rel="noreferrer" aria-label={`查看商品 ${content.title || "商品"}`}>{body}</a>
      : <div className={styles.productCard}>{body}</div>;
  }
  if (content.type === "msgmenu") {
    return (
      <div className={styles.menuCard}>
        {content.headContent ? <p>{content.headContent}</p> : null}
        <div>{content.items?.map((item, index) => item.url ? (
          <a href={item.url} target="_blank" rel="noreferrer" key={`${item.type}-${index}`}>{item.label || "查看"}<ExternalLink size={13} aria-hidden="true" /></a>
        ) : <span key={`${item.type}-${index}`}>{item.label || "菜单项"}</span>)}</div>
        {content.tailContent ? <small>{content.tailContent}</small> : null}
      </div>
    );
  }
  return null;
}

function locationMapUrl(content: ConversationWorkbenchContent) {
  if (!Number.isFinite(content.latitude) || !Number.isFinite(content.longitude)) return "";
  const params = new URLSearchParams({
    position: `${content.longitude},${content.latitude}`,
    name: content.name || content.address || "客户分享的位置",
  });
  return `https://uri.amap.com/marker?${params.toString()}`;
}
