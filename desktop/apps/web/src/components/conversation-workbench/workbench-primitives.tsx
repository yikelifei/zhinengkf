import {
  BookOpen,
  File,
  FileImage,
  Image as ImageIcon,
  MessageSquareText,
  PackageSearch,
  Paperclip,
  Smile,
  UserRound,
} from "lucide-react";
import type { ReactNode } from "react";
import styles from "./conversation-workbench.module.css";
import type {
  ConversationWorkbenchAvatar,
  ConversationWorkbenchComposerTool,
  ConversationWorkbenchTone,
} from "./types";

export function WorkbenchAvatar({ avatar, size = "medium" }: { avatar: ConversationWorkbenchAvatar; size?: "small" | "medium" | "large" }) {
  return (
    <span className={`${styles.avatar} ${styles[`avatar-${size}`]}`}>
      {avatar.imageUrl ? <img alt={avatar.alt} src={avatar.imageUrl} /> : <span aria-label={avatar.alt}>{avatar.fallback.slice(0, 2)}</span>}
    </span>
  );
}

export function WorkbenchToneTag({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: ConversationWorkbenchTone;
  className?: string;
}) {
  return <span className={`${styles.toneTag} ${styles[`tone-${tone}`]} ${className}`.trim()}>{children}</span>;
}

export function ComposerToolIcon({ tool }: { tool: ConversationWorkbenchComposerTool }) {
  const iconProps = { size: 16, "aria-hidden": true } as const;
  switch (tool.id) {
    case "emoji":
      return <Smile {...iconProps} />;
    case "image":
      return <ImageIcon {...iconProps} />;
    case "file":
      return <Paperclip {...iconProps} />;
    case "note":
      return <File {...iconProps} />;
    case "knowledge":
      return <BookOpen {...iconProps} />;
    case "script":
      return <MessageSquareText {...iconProps} />;
    case "customer":
      return <UserRound {...iconProps} />;
    case "order":
      return <PackageSearch {...iconProps} />;
    default:
      return <FileImage {...iconProps} />;
  }
}
