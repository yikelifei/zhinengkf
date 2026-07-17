import Link from "next/link";
import styles from "./sales-pages.module.css";
import { SalesHeader } from "./sales-ui";

export function SalesActionsPage() {
  return (
    <section className={styles.page} aria-label="销售处理入口">
      <SalesHeader
        eyebrow="报价与订单"
        title="选择销售处理目标"
        detail="本页只负责导航，不跨域执行报价发送、订单推进或付款处理。"
      />
      <div className={styles.actionChoiceGrid}>
        <Link className={styles.actionChoice} href="/sales/quotes">
          <strong>处理报价</strong>
          <span>创建、核验并在明确确认后进入安全发送队列。</span>
        </Link>
        <Link className={styles.actionChoice} href="/sales/orders">
          <strong>处理订单</strong>
          <span>核验付款与身份后推进确认、生产和交付。</span>
        </Link>
      </div>
    </section>
  );
}
