"use client";

import {
  BarChart3,
  Check,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  UserMinus,
  UserPlus,
  UsersRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  addWechatWorkCustomerServiceServicers,
  createWechatWorkCustomerServiceAccount,
  deleteWechatWorkCustomerServiceAccount,
  deleteWechatWorkCustomerServiceServicers,
  getOperatorAccessStatus,
  getWechatWorkCustomerServiceOperations,
  getWechatWorkCustomerServiceStatistics,
  updateWechatWorkCustomerServiceAccount,
  type OperatorAccessStatus,
  type WechatWorkCustomerServiceOperations,
  type WechatWorkCustomerServiceStatistics,
} from "../../lib/api";
import { FeatureNotice, FeaturePage, LoadingState, errorMessage } from "./feature-page";
import styles from "./wechat-work-operations-page.module.css";

type AvatarDraft = { avatarBase64: string; avatarFileName: string; avatarMimeType: string };

export function WechatWorkOperationsPage() {
  const [operations, setOperations] = useState<WechatWorkCustomerServiceOperations | null>(null);
  const [access, setAccess] = useState<OperatorAccessStatus | null>(null);
  const [selectedOpenKfid, setSelectedOpenKfid] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [memberQuery, setMemberQuery] = useState("");
  const [editingName, setEditingName] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [createName, setCreateName] = useState("");
  const [createAvatar, setCreateAvatar] = useState<AvatarDraft | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [statistics, setStatistics] = useState<WechatWorkCustomerServiceStatistics | null>(null);
  const [statisticsStartDate, setStatisticsStartDate] = useState(() => shanghaiDateDaysAgo(7));
  const [statisticsEndDate, setStatisticsEndDate] = useState(() => shanghaiDateDaysAgo(1));
  const [statisticsBusy, setStatisticsBusy] = useState(false);
  const [statisticsError, setStatisticsError] = useState("");

  const refresh = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const [nextOperations, nextAccess] = await Promise.all([
        getWechatWorkCustomerServiceOperations(),
        getOperatorAccessStatus(),
      ]);
      setOperations(nextOperations);
      setAccess(nextAccess);
      setSelectedOpenKfid((current) => {
        if (nextOperations.accounts.some((account) => account.openKfid === current)) return current;
        return nextOperations.accounts.find((account) => account.configured)?.openKfid
          || nextOperations.accounts[0]?.openKfid
          || "";
      });
    } catch (loadError) {
      setError(errorMessage(loadError, "企业微信客服运营数据读取失败"));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectedAccount = operations?.accounts.find((account) => account.openKfid === selectedOpenKfid) || null;
  const canManage = Boolean(
    access?.enforcementReady
    && access.capabilities.includes("manage_channels")
    && selectedAccount?.managePrivilege,
  );
  const assignedUserIds = useMemo(
    () => new Set(selectedAccount?.servicers.map((servicer) => servicer.userId) || []),
    [selectedAccount],
  );
  const memberOptions = useMemo(() => {
    const query = memberQuery.trim().toLocaleLowerCase("zh-CN");
    return (operations?.availableMembers || []).filter((member) => {
      if (assignedUserIds.has(member.userId)) return false;
      if (!query) return true;
      return `${member.displayName} ${member.userId}`.toLocaleLowerCase("zh-CN").includes(query);
    });
  }, [assignedUserIds, memberQuery, operations]);

  useEffect(() => {
    setEditingName(selectedAccount?.name || "");
    setDeleteConfirmation("");
    setSelectedUserIds([]);
    setMemberQuery("");
    setStatistics(null);
    setStatisticsError("");
  }, [selectedAccount?.name, selectedOpenKfid]);

  const loadStatistics = useCallback(async () => {
    if (!selectedOpenKfid) return;
    setStatisticsBusy(true);
    setStatisticsError("");
    try {
      setStatistics(await getWechatWorkCustomerServiceStatistics({
        openKfid: selectedOpenKfid,
        startDate: statisticsStartDate,
        endDate: statisticsEndDate,
      }));
    } catch (loadError) {
      setStatistics(null);
      setStatisticsError(errorMessage(loadError, "企业微信客服统计读取失败"));
    } finally {
      setStatisticsBusy(false);
    }
  }, [selectedOpenKfid, statisticsEndDate, statisticsStartDate]);

  const runMutation = useCallback(async (operation: () => Promise<unknown>, successMessage: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
      setNotice(successMessage);
      await refresh();
    } catch (mutationError) {
      setError(errorMessage(mutationError, "企业微信配置操作失败"));
      setBusy(false);
    }
  }, [refresh]);

  const createAccount = useCallback(async () => {
    if (!createAvatar) {
      setError("新建客服账号需要上传 PNG 或 JPG 头像。");
      return;
    }
    await runMutation(async () => {
      const result = await createWechatWorkCustomerServiceAccount({
        name: createName,
        avatarBase64: createAvatar.avatarBase64,
        avatarFileName: createAvatar.avatarFileName,
        avatarMimeType: createAvatar.avatarMimeType,
        requestId: operationId("create-account"),
      });
      setSelectedOpenKfid(result.openKfid);
      setCreateName("");
      setCreateAvatar(null);
      setShowCreate(false);
    }, "客服账号已在企业微信创建。");
  }, [createAvatar, createName, runMutation]);

  const updateAccount = useCallback(async () => {
    if (!selectedAccount) return;
    await runMutation(
      () => updateWechatWorkCustomerServiceAccount({
        openKfid: selectedAccount.openKfid,
        name: editingName,
        requestId: operationId("update-account"),
      }),
      "客服账号名称已同步到企业微信。",
    );
  }, [editingName, runMutation, selectedAccount]);

  const deleteAccount = useCallback(async () => {
    if (!selectedAccount) return;
    await runMutation(
      () => deleteWechatWorkCustomerServiceAccount({
        openKfid: selectedAccount.openKfid,
        confirmName: deleteConfirmation,
        requestId: operationId("delete-account"),
      }),
      "客服账号已从企业微信删除。",
    );
  }, [deleteConfirmation, runMutation, selectedAccount]);

  const addServicers = useCallback(async () => {
    if (!selectedAccount || !selectedUserIds.length) return;
    await runMutation(
      () => addWechatWorkCustomerServiceServicers({
        openKfid: selectedAccount.openKfid,
        userIds: selectedUserIds,
        requestId: operationId("add-servicers"),
      }),
      `已向企业微信提交 ${selectedUserIds.length} 名接待人员。`,
    );
  }, [runMutation, selectedAccount, selectedUserIds]);

  const removeServicer = useCallback(async (userId: string, displayName: string) => {
    if (!selectedAccount || !window.confirm(`确认从“${selectedAccount.name}”移除接待人员“${displayName}”？`)) return;
    await runMutation(
      () => deleteWechatWorkCustomerServiceServicers({
        openKfid: selectedAccount.openKfid,
        userIds: [userId],
        requestId: operationId("delete-servicer"),
      }),
      `接待人员“${displayName}”已移除。`,
    );
  }, [runMutation, selectedAccount]);

  return (
    <FeaturePage
      id="wechat-work-operations-page"
      title="企业微信客服运营"
      description="统一管理微信客服账号、接待人员和企业成员，不需要为日常配置反复切换企业微信后台。"
      icon={<UsersRound size={20} />}
      busy={busy}
      actions={(
        <>
          <button type="button" data-action-id="wechat-work.operations.toggle-create-account" aria-label={showCreate ? "取消新建企业微信客服账号" : "新建企业微信客服账号"} onClick={() => setShowCreate((value) => !value)} disabled={busy || !access?.capabilities.includes("manage_channels")}>
            {showCreate ? <X size={15} aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
            {showCreate ? "取消新建" : "新建客服账号"}
          </button>
          <button type="button" data-action-id="wechat-work.operations.refresh" aria-label="刷新企业微信客服运营数据" onClick={() => void refresh()} disabled={busy}>
            <RefreshCw size={15} aria-hidden="true" /> 刷新企业微信
          </button>
        </>
      )}
    >
      {error ? <FeatureNotice tone="error" title="操作未完成">{error}</FeatureNotice> : null}
      {notice ? <FeatureNotice tone="success" title="企业微信已接受配置变更">{notice}</FeatureNotice> : null}
      {operations?.partial ? (
        <FeatureNotice tone="warning" title="部分数据未读取完整">
          {operations.directoryError || "个别客服账号的接待人员列表读取失败，请检查微信客服应用权限。"}
        </FeatureNotice>
      ) : null}
      {!access?.capabilities.includes("manage_channels") && access ? (
        <FeatureNotice tone="warning" title="当前账号只有查看权限">账号增删、改名和接待人员调整需要“管理通道”权限。</FeatureNotice>
      ) : null}

      {showCreate ? (
        <section className={styles.createBand} aria-labelledby="wechat-work-create-account-title">
          <div>
            <h2 id="wechat-work-create-account-title">新建客服账号</h2>
            <p>账号名称和头像会直接写入企业微信。头像仅支持 PNG/JPG，最大 2MB。</p>
          </div>
          <label>
            客服名称
            <input value={createName} onChange={(event) => setCreateName(event.target.value)} maxLength={64} placeholder="例如：礼品顾问" />
          </label>
          <label className={styles.fileButton}>
            <Upload size={15} aria-hidden="true" />
            {createAvatar ? createAvatar.avatarFileName : "选择头像"}
            <input type="file" accept="image/png,image/jpeg" onChange={(event) => void readAvatar(event.target.files?.[0]).then(setCreateAvatar).catch((avatarError) => setError(errorMessage(avatarError, "头像读取失败")))} />
          </label>
          <button className={styles.primaryButton} type="button" data-action-id="wechat-work.operations.create-account" aria-label="确认创建企业微信客服账号" onClick={() => void createAccount()} disabled={busy || !createName.trim() || !createAvatar}>
            <Check size={15} aria-hidden="true" /> 确认创建
          </button>
        </section>
      ) : null}

      {busy && !operations ? <LoadingState label="正在读取企业微信客服账号和接待人员" /> : null}
      {operations ? (
        <>
          <div className={styles.metrics} aria-label="客服运营概览">
            <Metric label="客服账号" value={operations.accountCount} />
            <Metric label="接待人员" value={operations.servicerCount} />
            <Metric label="可管理账号" value={operations.manageableAccountCount} />
            <Metric label="可选企业成员" value={operations.availableMembers.length} />
          </div>

          <section className={styles.statisticsBand} aria-labelledby="wechat-work-statistics-title">
            <div className={styles.sectionTitle}>
              <div>
                <h2 id="wechat-work-statistics-title"><BarChart3 size={17} aria-hidden="true" /> 客服经营统计</h2>
                <p>读取企业微信已完成计算的日统计；当天数据从次日开始可查，单次最多 31 天。</p>
              </div>
              {statistics ? <span>{statistics.period.dayCount} 天</span> : null}
            </div>
            <div className={styles.statisticsControls}>
              <label>
                客服账号
                <select value={selectedOpenKfid} onChange={(event) => setSelectedOpenKfid(event.target.value)} disabled={statisticsBusy}>
                  {operations.accounts.map((account) => <option key={account.openKfid} value={account.openKfid}>{account.name}</option>)}
                </select>
              </label>
              <label>
                开始日期
                <input type="date" value={statisticsStartDate} max={statisticsEndDate} onChange={(event) => setStatisticsStartDate(event.target.value)} disabled={statisticsBusy} />
              </label>
              <label>
                结束日期
                <input type="date" value={statisticsEndDate} min={statisticsStartDate} max={shanghaiDateDaysAgo(1)} onChange={(event) => setStatisticsEndDate(event.target.value)} disabled={statisticsBusy} />
              </label>
              <button className={styles.primaryButton} type="button" data-action-id="wechat-work.operations.load-statistics" aria-label="查询企业微信官方客服统计" onClick={() => void loadStatistics()} disabled={statisticsBusy || !selectedOpenKfid || !statisticsStartDate || !statisticsEndDate}>
                <BarChart3 size={15} aria-hidden="true" /> {statisticsBusy ? "正在读取" : "查询官方统计"}
              </button>
            </div>
            {statisticsError ? <FeatureNotice tone="error" title="统计读取失败">{statisticsError}</FeatureNotice> : null}
            {statisticsBusy ? <LoadingState label="正在按接待人员顺序读取企业微信官方统计" /> : null}
            {statistics?.error ? (
              <div className={styles.statisticsStatus} data-status={statistics.status} role="status">
                <strong>{statisticsStatusTitle(statistics.status)}</strong>
                <p>{statistics.error.message}</p>
              </div>
            ) : null}
            {statistics && !statistics.error ? (
              <>
                <div className={styles.statisticsMetrics} aria-label="企业微信客服经营指标">
                  <Metric label="咨询会话" value={formatCount(statistics.corporate?.summary.sessionCount)} />
                  <Metric label="咨询客户（日累计）" value={formatCount(statistics.corporate?.summary.customerCount)} />
                  <Metric label="客户消息" value={formatCount(statistics.corporate?.summary.customerMessageCount)} />
                  <Metric label="智能回复会话" value={formatCount(statistics.corporate?.summary.aiSessionReplyCount)} />
                  <Metric label="转人工率（日均）" value={formatPercent(statistics.corporate?.summary.aiTransferRate)} />
                  <Metric label="人工回复率（日均）" value={formatPercent(statistics.servicerSummary?.summary.replyRate)} />
                  <Metric label="首次响应（日均）" value={formatSeconds(statistics.servicerSummary?.summary.firstReplyAverageSec)} />
                  <Metric label="升级服务客户" value={formatCount(statistics.corporate?.summary.upgradeServiceCustomerCount)} />
                </div>
                {statistics.status === "empty" ? <p className={styles.statisticsEmpty}>所选日期内企业微信尚未返回可用统计数据。</p> : null}
                {statistics.partial ? (
                  <FeatureNotice tone="warning" title={statistics.partialReason === "rate_limited" ? "官方限流，本轮已停止后续读取" : "部分接待人员统计未返回"}>
                    {statistics.partialReason === "rate_limited"
                      ? "已保留限流前取得的数据；请稍后手动重试，本轮没有继续请求剩余人员。"
                      : "已保留可用数据；失败人员不会被计入下表，请稍后重试或检查其应用可见范围。"}
                  </FeatureNotice>
                ) : null}
                <div className={styles.statisticsTableWrap}>
                  <table className={styles.statisticsTable}>
                    <thead><tr><th>接待人员</th><th>人工会话</th><th>咨询客户（日累计）</th><th>回复率（日均）</th><th>首响（日均）</th><th>满意率（日均）</th><th>升级服务客户</th><th>拒收客户</th></tr></thead>
                    <tbody>
                      {statistics.servicers.map((servicer) => (
                        <tr key={servicer.userId}>
                          <td><strong>{servicer.displayName}</strong><small>{servicer.nameResolution === "userid_fallback" ? `成员 ID：${servicer.userId}` : servicer.statusName}</small></td>
                          <td>{formatCount(servicer.summary.sessionCount)}</td>
                          <td>{formatCount(servicer.summary.customerCount)}</td>
                          <td>{formatPercent(servicer.summary.replyRate)}</td>
                          <td>{formatSeconds(servicer.summary.firstReplyAverageSec)}</td>
                          <td>{formatPercent(servicer.summary.satisfiedRate)}</td>
                          <td>{formatCount(servicer.summary.upgradeServiceCustomerCount)}</td>
                          <td>{formatCount(servicer.summary.messageRejectedCustomerCount)}</td>
                        </tr>
                      ))}
                      {!statistics.servicers.length ? <tr><td colSpan={8} className={styles.statisticsEmpty}>该客服账号没有可显示的接待人员统计。</td></tr> : null}
                    </tbody>
                  </table>
                </div>
                <p className={styles.proofBoundary}>{statistics.proofBoundary}</p>
              </>
            ) : null}
          </section>

          <div className={styles.workspace}>
            <nav className={styles.accountList} aria-label="微信客服账号">
              <div className={styles.sectionTitle}>
                <h2>客服账号</h2>
                <span>{operations.accountCount}</span>
              </div>
              {operations.accounts.map((account) => (
                <button
                  type="button"
                  key={account.openKfid}
                  data-action-id={`wechat-work.operations.select-account-${account.openKfid}`}
                  aria-label={`选择客服账号 ${account.name || account.openKfid}`}
                  className={account.openKfid === selectedOpenKfid ? styles.accountSelected : styles.accountButton}
                  onClick={() => setSelectedOpenKfid(account.openKfid)}
                >
                  {account.avatar ? <img src={account.avatar} alt="" /> : <span className={styles.avatarFallback}>{account.name.slice(0, 1)}</span>}
                  <span>
                    <strong>{account.name || "未命名客服"}</strong>
                    <small>{account.servicers.length} 名接待人员{account.configured ? " · 当前固定账号" : ""}</small>
                  </span>
                </button>
              ))}
            </nav>

            <section className={styles.accountDetail} aria-label="客服账号详情">
              {selectedAccount ? (
                <>
                  <header className={styles.detailHeader}>
                    <div>
                      <h2>{selectedAccount.name}</h2>
                      <p>{selectedAccount.openKfid}</p>
                    </div>
                    <span className={selectedAccount.managePrivilege ? styles.permissionReady : styles.permissionReadOnly}>
                      {selectedAccount.managePrivilege ? "可管理" : "只读"}
                    </span>
                  </header>

                  <section className={styles.operationSection} aria-labelledby="wechat-work-account-settings-title">
                    <div className={styles.sectionTitle}>
                      <div>
                        <h3 id="wechat-work-account-settings-title">账号设置</h3>
                        <p>改名立即同步到企业微信；当前固定客服账号禁止删除。</p>
                      </div>
                    </div>
                    <div className={styles.inlineForm}>
                      <label>
                        客服名称
                        <input value={editingName} onChange={(event) => setEditingName(event.target.value)} disabled={!canManage || busy} maxLength={64} />
                      </label>
                      <button type="button" data-action-id="wechat-work.operations.update-account-name" aria-label="保存企业微信客服账号名称" onClick={() => void updateAccount()} disabled={!canManage || busy || !editingName.trim() || editingName.trim() === selectedAccount.name}>
                        <Pencil size={15} aria-hidden="true" /> 保存名称
                      </button>
                    </div>
                  </section>

                  <section className={styles.operationSection} aria-labelledby="wechat-work-servicers-title">
                    <div className={styles.sectionTitle}>
                      <div>
                        <h3 id="wechat-work-servicers-title">接待人员</h3>
                        <p>成员中文名称来自企业微信通讯录，成员 ID 仅作为辅助识别。</p>
                      </div>
                      <span>{selectedAccount.servicers.length}</span>
                    </div>
                    <div className={styles.servicerList}>
                      {selectedAccount.servicers.map((servicer) => (
                        <div className={styles.servicerRow} key={servicer.userId}>
                          {servicer.avatar ? <img src={servicer.avatar} alt="" /> : <span className={styles.memberAvatar}>{servicer.displayName.slice(0, 1)}</span>}
                          <span>
                            <strong>{servicer.displayName}</strong>
                            <small>{servicer.userId} · {servicer.statusName}</small>
                          </span>
                          <button type="button" data-action-id={`wechat-work.operations.remove-servicer-${servicer.userId}`} title="移除接待人员" aria-label={`移除接待人员 ${servicer.displayName}`} onClick={() => void removeServicer(servicer.userId, servicer.displayName)} disabled={!canManage || busy || selectedAccount.servicers.length <= 1}>
                            <UserMinus size={16} aria-hidden="true" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className={styles.memberPicker}>
                      <label>
                        查找企业成员
                        <input value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} placeholder="输入中文姓名或成员 ID" disabled={!canManage || busy || operations.memberSource === "assigned_servicers_only"} />
                      </label>
                      <p className={styles.memberSource}>{operations.memberSourceDetail}</p>
                      <div className={styles.memberOptions}>
                        {memberOptions.slice(0, 50).map((member) => {
                          const checked = selectedUserIds.includes(member.userId);
                          return (
                            <label key={member.userId} className={checked ? styles.memberOptionChecked : styles.memberOption}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => setSelectedUserIds((current) => checked ? current.filter((id) => id !== member.userId) : [...current, member.userId])}
                              />
                              <span><strong>{member.displayName}</strong><small>{member.userId}</small></span>
                            </label>
                          );
                        })}
                      </div>
                      <button className={styles.primaryButton} type="button" data-action-id="wechat-work.operations.add-servicers" aria-label="添加所选企业微信接待成员" onClick={() => void addServicers()} disabled={!canManage || busy || !selectedUserIds.length}>
                        <UserPlus size={15} aria-hidden="true" /> 添加所选成员（{selectedUserIds.length}）
                      </button>
                    </div>
                  </section>

                  <section className={styles.dangerSection} aria-labelledby="wechat-work-delete-account-title">
                    <div>
                      <h3 id="wechat-work-delete-account-title">删除客服账号</h3>
                      <p>删除会影响该账号入口和后续接待。请输入完整账号名称后才能执行。</p>
                    </div>
                    <input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} placeholder={selectedAccount.name} disabled={!canManage || selectedAccount.configured || busy} />
                    <button type="button" data-action-id="wechat-work.operations.delete-account" aria-label="删除企业微信客服账号" onClick={() => void deleteAccount()} disabled={!canManage || selectedAccount.configured || busy || deleteConfirmation !== selectedAccount.name}>
                      <Trash2 size={15} aria-hidden="true" /> 删除账号
                    </button>
                  </section>
                </>
              ) : <p className={styles.empty}>企业微信未返回可管理的客服账号。</p>}
            </section>
          </div>
          <p className={styles.proofBoundary}>{operations.proofBoundary}</p>
        </>
      ) : null}
    </FeaturePage>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return <div><strong>{value}</strong><span>{label}</span></div>;
}

function formatCount(value: number | null | undefined) {
  return value == null ? "--" : new Intl.NumberFormat("zh-CN").format(value);
}

function formatPercent(value: number | null | undefined) {
  return value == null ? "--" : `${(value * 100).toFixed(1)}%`;
}

function formatSeconds(value: number | null | undefined) {
  if (value == null) return "--";
  if (value < 60) return `${value.toFixed(1)} 秒`;
  return `${(value / 60).toFixed(1)} 分钟`;
}

function statisticsStatusTitle(status: WechatWorkCustomerServiceStatistics["status"]) {
  if (status === "permission_required") return "需要补充企业微信统计权限";
  if (status === "rate_limited") return "企业微信接口正在限流";
  return "企业微信统计暂不可用";
}

function shanghaiDateDaysAgo(daysAgo: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000));
  const part = (type: string) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function operationId(action: string) {
  return `wechat-work:${action}:${globalThis.crypto?.randomUUID?.() || Date.now()}`;
}

async function readAvatar(file?: File): Promise<AvatarDraft | null> {
  if (!file) return null;
  if (!/^image\/(png|jpeg)$/.test(file.type)) throw new Error("客服头像只支持 PNG 或 JPG");
  if (file.size > 2 * 1024 * 1024) throw new Error("客服头像必须小于 2MB");
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("头像文件读取失败"));
    reader.readAsDataURL(file);
  });
  return {
    avatarBase64: dataUrl.replace(/^data:image\/(?:png|jpeg);base64,/i, ""),
    avatarFileName: file.name,
    avatarMimeType: file.type,
  };
}
