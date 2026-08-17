"use client";

import { ImageOff } from "lucide-react";
import { useState } from "react";
import type { DesignJob } from "../../lib/api";
import { designImagePreviewSrc } from "../design/model";
import styles from "./review-design-gallery.module.css";

export function ReviewDesignGallery({ job }: { job: DesignJob }) {
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const images = job.images || [];
  if (!images.length) return <p className={styles.empty}>当前没有可审核候选图，图稿通过与批准发送保持禁用。</p>;
  return (
    <section className={styles.gallery} aria-label="待人工审核候选图">
      {images.map((image, index) => {
        const imageKey = image.id || image.imageId || String(index);
        const src = designImagePreviewSrc(job, image);
        const unavailable = image.localFile && image.localFile.state !== "ready";
        const renderable = Boolean(src && !unavailable && !failedImages.includes(imageKey));
        return (
          <figure className={styles.tile} data-selected={image.selected || undefined} key={imageKey}>
            {renderable ? (
              <img
                src={src}
                alt={`待审核候选图 ${index + 1}`}
                onError={() => setFailedImages((current) => current.includes(imageKey) ? current : [...current, imageKey])}
              />
            ) : (
              <span className={styles.unavailable}><ImageOff size={20} aria-hidden="true" />{image.localFile?.message || "图片预览不可用"}</span>
            )}
            <figcaption>
              <span><strong>候选图 {index + 1}</strong><small>{image.imageId || image.id}</small></span>
              {image.selected ? <em>客户已选</em> : null}
            </figcaption>
          </figure>
        );
      })}
    </section>
  );
}
