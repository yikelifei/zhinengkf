import type { SkuPayload } from "../../lib/api";
import styles from "./catalog-pages.module.css";
import { CatalogProductImage, catalogSkuImageRefs } from "./catalog-ui";

export function CatalogProductImagePreview({ draft }: { draft: SkuPayload }) {
  const imageRefs = catalogSkuImageRefs(draft);
  const mainReady = Boolean(draft.mainImagePath?.trim());
  const angleCount = imageRefs.length > 1 ? imageRefs.length - 1 : 0;
  return (
    <section className={styles.productImagePreview} aria-label="商品图片预览">
      <div className={styles.productImagePreviewHeader}>
        <strong>商品图片预览</strong>
        <span>{mainReady ? "主图已填写" : "缺少主图"} / {angleCount} 张多角度图</span>
      </div>
      <div className={styles.productImagePreviewGrid}>
        <CatalogProductImage sku={draft} label={draft.name || draft.skuCode || "商品主图"} variant="hero" />
        <div className={styles.productImagePreviewAngles}>
          {imageRefs.slice(1, 5).map((reference, index) => (
            <CatalogProductImage key={`${reference}-${index}`} reference={reference} label={`角度图 ${index + 1}`} variant="mini" />
          ))}
          {imageRefs.length <= 1 ? <p>多角度图为空，搭配和审核只能参考主图。</p> : null}
        </div>
      </div>
    </section>
  );
}
