import { useState, useEffect, useCallback, useRef } from 'react';
import Nav from './shell/Nav';
import type { NavCounts } from './shell/Nav';
import { DEFAULT_TAB } from './shell/routes';
import { useMediaQuery } from './lib/useMediaQuery';
import type { PageId, TabId } from './shell/routes';
import TodayPage from './pages/TodayPage';
import type { RunningTask } from './pages/TodayPage';
import { useToday } from './pages/useToday';
import { ComingSoon, CreateFrame, TabbedPage } from './pages/frames';
import ChatPage from './components/ChatPage';
import type { ChatDraft } from './components/ChatPage';
import WorksPanel from './pages/WorksPanel';
import AbilitiesPage from './pages/AbilitiesPage';
import WorksLibrary from './pages/WorksLibrary';
import AccountsPage from './components/AccountsPage';
import ProfilePage from './components/ProfilePage';
import CalendarPage from './components/CalendarPage';
import PublishPage from './components/PublishPage';
import { Welcome, Wizard } from './pages/Onboarding';
import SettingsPage from './pages/SettingsPage';
import { BreakdownView, IdeasView, TrendsView } from './pages/InspirePages';
import { fetchStatus, fetchPersonas, streamChat, fetchLastTurn, stopChat } from './lib/api';
import type { PersonaItem, UploadedFile, ChatQuestion } from './lib/api';
import { questionStatus } from './lib/api';
import { deleteSession as deleteRemoteSession } from './lib/api';
import {
  loadSessions,
  saveSessions,
  createSession,
  updateSessionTitle,
  openTurn,
  prependSession,
  closeTurn,
  loadActiveId,
  saveActiveId,
  loadPublishDraft,
  savePublishDraft,
} from './lib/store';
import type { ChatSession, ChatMessage, StreamState } from './lib/store';

const ONBOARDING_SEEN_KEY = 'easel_onboarding_seen';

function onboardingSeen(): boolean {
  const current = localStorage.getItem(ONBOARDING_SEEN_KEY);
  if (current) return true;
  const previousKey = `${['post', 'craft'].join('')}_onboarding_seen`;
  const previous = localStorage.getItem(previousKey);
  if (previous) {
    localStorage.setItem(ONBOARDING_SEEN_KEY, previous);
    localStorage.removeItem(previousKey);
    return true;
  }
  return false;
}

export default function App() {
  const [currentPage, setCurrentPage] = useState<PageId>('today');
  const [tabs, setTabs] = useState<Partial<Record<PageId, TabId>>>(DEFAULT_TAB);
  const navigate = useCallback((page: PageId, tab?: TabId) => {
    setCurrentPage(page);
    if (tab) setTabs((t) => ({ ...t, [page]: tab }));
  }, []);
  const [personas, setPersonas] = useState<PersonaItem[]>([]);
  const [personasLoaded, setPersonasLoaded] = useState(false);
  const [selectedPersona, setSelectedPersona] = useState('');
  const [sessions, setSessions] = useState<ChatSession[]>(() => loadSessions());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [gatewayStatus, setGatewayStatus] = useState('connecting');
  const [showRecommend, setShowRecommend] = useState(false);
  const [showWizard, setShowWizard] = useState(false);

  // 对话里的「产物路径 → 内容库」跳转：linkifyOutputs 把目录路径生成为
  // `#/outputs/<路径>` 锚点，这里监听 hashchange 切页并带上下文，随后清掉 hash
  // （不污染地址栏与前进/后退历史）。
  const [outputsJump, setOutputsJump] = useState('');
  useEffect(() => {
    const onHash = () => {
      const m = window.location.hash.match(/^#\/outputs\/(.+)$/);
      if (!m) return;
      let path = m[1];
      try { path = decodeURIComponent(path); } catch { /* 保留原样 */ }
      setOutputsJump(path);
      setCurrentPage('works');
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const clearOutputsJump = useCallback(() => setOutputsJump(''), []);

  // 挂载时决定进哪个会话。规则：
  //  - 同一标签刷新（sessionStorage 记着本标签的会话）→ 直接续上（同标签不算冲突）。
  //  - 新开标签/窗口 → 若「上次活跃会话」正被另一个存活标签占用（跨标签 BroadcastChannel 探测），
  //    则开一个新会话，避免两个窗口撞同一会话 → openclaw 并发 takeover 崩溃（后端还有 flock 兜底）。
  //  - 否则续上上次会话（保留「关页重开续接」的体验）。
  const TAB_SESSION_KEY = 'easel_tab_session';
  useEffect(() => {
    const existing = loadSessions();
    let ch: BroadcastChannel | null = null;
    try { ch = new BroadcastChannel('easel-session'); } catch { ch = null; }

    const settle = (id: string, sess: ChatSession[]) => {
      setSessions(sess);
      setActiveSessionId(id);
      const s = sess.find((x) => x.id === id);
      if (s) setSelectedPersona(s.persona || '');
      try { sessionStorage.setItem(TAB_SESSION_KEY, id); } catch { /* ignore */ }
      ch?.postMessage({ type: 'claim', sessionId: id });
    };
    const openNew = (sess: ChatSession[]) => {
      const ns = createSession();
      const updated = [ns, ...sess];
      saveSessions(updated);
      settle(ns.id, updated);
    };

    // 持久监听：别的标签问「谁在用会话 X」时，若正是本标签当前会话就应答 owned
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; sessionId?: string } | null;
      if (d?.type === 'query' && d.sessionId && d.sessionId === activeIdRef.current) {
        ch?.postMessage({ type: 'owned', sessionId: d.sessionId });
      }
    };
    ch?.addEventListener('message', onMsg);

    // 1) 本标签刷新：续本标签原会话
    let tabOwn: string | null = null;
    try { tabOwn = sessionStorage.getItem(TAB_SESSION_KEY); } catch { tabOwn = null; }
    if (tabOwn && existing.find((s) => s.id === tabOwn)) {
      settle(tabOwn, existing);
      return () => { ch?.removeEventListener('message', onMsg); ch?.close(); };
    }

    // 2) 新标签：候选=上次活跃会话；先跨标签问有没有别的活标签占着它
    const lastId = loadActiveId();
    const candidate = lastId && existing.find((s) => s.id === lastId) ? lastId : null;
    if (candidate && ch) {
      let taken = false;
      const probe = (e: MessageEvent) => {
        const d = e.data as { type?: string; sessionId?: string } | null;
        if (d?.type === 'owned' && d.sessionId === candidate) taken = true;
      };
      ch.addEventListener('message', probe);
      ch.postMessage({ type: 'query', sessionId: candidate });
      const t = setTimeout(() => {
        ch?.removeEventListener('message', probe);
        if (taken) openNew(existing);      // 另一个窗口在用 → 开新会话
        else settle(candidate, existing);  // 没人占 → 续上
      }, 250);
      return () => { clearTimeout(t); ch?.removeEventListener('message', probe); ch?.removeEventListener('message', onMsg); ch?.close(); };
    }

    // 3) 无候选 / 不支持 BroadcastChannel：退化为原逻辑（复用空会话或新建；后端 flock 兜底防崩）
    if (candidate) {
      settle(candidate, existing);
    } else {
      const empty = existing.find((s) => s.messages.length === 0);
      if (empty) settle(empty.id, existing);
      else openNew(existing);
    }
    return () => { ch?.removeEventListener('message', onMsg); ch?.close(); };
  }, []);

  // 持久化当前活跃会话 id，重开网页据此续接上次对话（修复"今天再问就忘了"）。
  // 仅在非空时写：避免挂载首刷 activeSessionId 尚为 null 时误清掉已存的 id。
  // 同时更新本标签的 sessionStorage 标记：手动切会话/新建后刷新本标签仍续在正确会话上。
  useEffect(() => {
    if (activeSessionId) {
      saveActiveId(activeSessionId);
      try { sessionStorage.setItem(TAB_SESSION_KEY, activeSessionId); } catch { /* ignore */ }
    }
  }, [activeSessionId]);

  // Fetch status on mount — 真实反映 gateway 状态 + 首次引导检测
  useEffect(() => {
    fetchStatus()
      .then((data) => {
        setPersonas(data.personas || []);
        setPersonasLoaded(true);
        setGatewayStatus(data.gateway ? 'connected' : 'disconnected');
        // 首次使用：没有任何个性化画像 且 未看过引导 → 推荐配置
        if ((data.personas || []).length === 0 && !onboardingSeen()) {
          setShowRecommend(true);
        }
      })
      .catch(() => {
        setGatewayStatus('disconnected');
      });
  }, []);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || null;

  // 最新 sessions 的 ref，供回调里读取而不必进依赖数组（避免闭包过期/频繁重建）
  const sessionsRef = useRef(sessions);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);

  // 当前活跃会话 id 的 ref：供跨标签「谁在用会话 X」查询时即时应答（见挂载 effect）
  const activeIdRef = useRef<string | null>(activeSessionId);
  useEffect(() => { activeIdRef.current = activeSessionId; }, [activeSessionId]);

  // ---- 流式对话：状态与生命周期都放在 App（永不卸载），切页/切 ChatPage 都不中断/丢失 ----
  const [streams, setStreams] = useState<Record<string, StreamState>>({});
  const streamCtl = useRef<Record<string, AbortController>>({});
  const streamAcc = useRef<Record<string, { content: string; thinking: string; steps: string[]; questions: ChatQuestion[] }>>({});
  const answeredRef = useRef<Set<string>>(new Set());   // 已提交答案的 question id：重放/恢复不再重现
  // ---- 打字机：分批到达的 token 按节奏吐给界面 ----
  const typingBuf = useRef<Record<string, string>>({});
  const typingTimer = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const TYPING_INTERVAL = 12;          // 每 tick 间隔 ms（短回复约 83 字/秒：快且有逐字感）

  const pumpTyping = (sessionId: string) => {
    const buf = typingBuf.current[sessionId] || '';
    if (!buf) { clearTyping(sessionId); return; }
    // 动态步长：<80 字逐字吐（83字/秒），每满 80 字每 tick 多吐 1 字，长文更快
    const step = Math.max(1, Math.floor(buf.length / 80));
    const take = buf.slice(0, step);
    typingBuf.current[sessionId] = buf.slice(step);
    const a = streamAcc.current[sessionId]; if (!a) { clearTyping(sessionId); return; }
    a.content += take;
    setStreams((p) => (p[sessionId] ? { ...p, [sessionId]: { ...p[sessionId], content: a.content } } : p));
  };
  const startTypingPump = (sessionId: string) => {
    if (typingTimer.current[sessionId]) return;
    typingTimer.current[sessionId] = setInterval(() => pumpTyping(sessionId), TYPING_INTERVAL);
  };
  const ensureTypingPump = (sessionId: string) => {
    if (!typingTimer.current[sessionId]) startTypingPump(sessionId);
  };
  const clearTyping = (sessionId: string) => {
    const t = typingTimer.current[sessionId];
    if (t) { clearInterval(t); delete typingTimer.current[sessionId]; }
  };
  /** 收尾冲刷：把剩余队列立刻吐完（避免结束瞬间内容被截断）。 */
  const flushTyping = (sessionId: string) => {
    clearTyping(sessionId);
    const buf = typingBuf.current[sessionId] || '';
    if (!buf) return;
    typingBuf.current[sessionId] = '';
    const a = streamAcc.current[sessionId]; if (!a) return;
    a.content += buf;
    setStreams((p) => (p[sessionId] ? { ...p, [sessionId]: { ...p[sessionId], content: a.content } } : p));
  };

  const appendAssistant = useCallback((sessionId: string, msg: ChatMessage, sessionKey?: string) => {
    setSessions((prev) => {
      const next = prev.map((s) =>
        s.id === sessionId
          ? closeTurn({ ...s, messages: [...s.messages, msg], sessionKey: sessionKey || s.sessionKey, pendingTurnId: undefined })
          : s);
      saveSessions(next);
      return next;
    });
  }, []);

  const clearStream = useCallback((sessionId: string) => {
    // 打字机收尾：剩余队列立刻吐出，避免结束瞬间内容被截断
    flushTyping(sessionId);
    delete streamCtl.current[sessionId];
    delete streamAcc.current[sessionId];
    setStreams((prev) => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
  }, []);

  // 启动一次流式（fetch + 累积 + 回调）——只管流，不动消息列表
  const startStream = useCallback((
    sessionId: string,
    text: string,
    persona: string | undefined,
    attachments: UploadedFile[] = [],
  ) => {
    const turnId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try { sessionStorage.setItem(`easel_pending_turn:${sessionId}`, turnId); } catch { /* ignore */ }
    setSessions((prev) => {
      const next = prev.map((s) => (s.id === sessionId ? openTurn(closeTurn({ ...s, pendingTurnId: turnId })) : s));
      saveSessions(next); return next;
    });
    streamAcc.current[sessionId] = { content: '', thinking: '', steps: [], questions: [] };
    setStreams((prev) => ({ ...prev, [sessionId]: { content: '', thinking: '', activity: '', questions: [] } }));
    // 打字机队列：流式事件按批到达（OpenClaw 攒批），前端按字符节奏显示，体验逐字浮现。
    typingBuf.current[sessionId] = '';
    startTypingPump(sessionId);
    streamCtl.current[sessionId] = streamChat(
      text, persona, sessionId,
      (chunk) => {
        const a = streamAcc.current[sessionId]; if (!a) return;
        // 不直接追加 content——进打字机队列，pump 按节奏吐出（切会话不中断，队列归属 sessionId）
        typingBuf.current[sessionId] = (typingBuf.current[sessionId] || '') + chunk;
        ensureTypingPump(sessionId);
      },
      (sessionKey) => {
        // done 不能立即 flush——token 和 done 几乎同时到达（OpenClaw 攒批），
        // 立即 flush 会把整包瞬间冲出，打字机白做。等队列吐完再落盘。
        const waitAndFinalize = () => {
          if (typingBuf.current[sessionId]) {
            setTimeout(waitAndFinalize, 60);
            return;
          }
          const a = streamAcc.current[sessionId];
          appendAssistant(sessionId, {
            role: 'assistant', content: a?.content || '',
            thinking: a?.thinking || undefined, activity: a?.steps.join('\n') || undefined,
          }, sessionKey);
          clearStream(sessionId);
          try { sessionStorage.removeItem(`easel_pending_turn:${sessionId}`); } catch { /* ignore */ }
        };
        waitAndFinalize();
      },
      (err) => {
        const waitAndFinalize = () => {
          if (typingBuf.current[sessionId]) {
            setTimeout(waitAndFinalize, 60);
            return;
          }
          const a = streamAcc.current[sessionId];
          appendAssistant(sessionId, {
            role: 'assistant',
            content: (a?.content ? a.content + '\n\n' : '') + `Error: ${err.message}`,
            thinking: a?.thinking || undefined, activity: a?.steps.join('\n') || undefined,
          });
          clearStream(sessionId);
          try { sessionStorage.removeItem(`easel_pending_turn:${sessionId}`); } catch { /* ignore */ }
        };
        waitAndFinalize();
      },
      (thinkChunk) => {
        const a = streamAcc.current[sessionId]; if (!a) return;
        a.thinking = (a.thinking + thinkChunk).slice(-4000);
        // 有真实思考流 → 清掉防呆提示（不再显示「未卡住」）
        setStreams((p) => (p[sessionId] ? { ...p, [sessionId]: { ...p[sessionId], thinking: a.thinking, stillWorking: undefined } } : p));
      },
      (status) => {
        const a = streamAcc.current[sessionId]; if (!a) return;
        if (a.steps[a.steps.length - 1] !== status) a.steps.push(status);
        // 有真实活动状态 → 清掉防呆提示，让真实状态占据活动行
        setStreams((p) => (p[sessionId] ? { ...p, [sessionId]: { ...p[sessionId], activity: status, stillWorking: undefined } } : p));
      },
      // onInterrupted：SSE 被中断（长任务时代理掐断），但后端仍在跑并会落盘完整结果。
      // streamChat 会按 eventId 自动重连并补发遗漏事件；这里只更新用户可见状态。
      () => {
        setStreams((p) => (p[sessionId]
          ? { ...p, [sessionId]: { ...p[sessionId], activity: '⏳ 连接中断，正在自动续接…' } } : p));
      },
      turnId,
      false,
      undefined,
      attachments,
      (q) => {
        // ask_user 问答题：追加进流式状态（去重），ChatPage 渲染为选项卡片
        // 重放可能带已解决/已过期的旧问题，先查状态只留 pending（失败则保留）
        const a = streamAcc.current[sessionId]; if (!a) return;
        if (a.questions.some((x) => x.id === q.id)) return;
        if (answeredRef.current.has(q.id)) return;   // 本会话已答过：不再重现
        void questionStatus([q.id]).then((st) => {
          const s = st[q.id]?.status;
          // 只显示仍 pending 的：answered/expired/cancelled/not_found/unknown 一律过滤
          if (s && s !== 'pending' || answeredRef.current.has(q.id)) return;
          const a2 = streamAcc.current[sessionId]; if (!a2) return;
          if (a2.questions.some((x) => x.id === q.id)) return;
          a2.questions.push(q);
          setStreams((p) => (p[sessionId]
            ? { ...p, [sessionId]: { ...p[sessionId], questions: [...a2.questions] } } : p));
        });
      },
      // onHeartbeat：防呆心跳（30s 静默）。只设独立的「未卡住」提示，绝不写 activity/thinking → 不顶掉真实状态。
      (note) => setStreams((p) => (p[sessionId] ? { ...p, [sessionId]: { ...p[sessionId], stillWorking: note } } : p)),
    );
  }, [appendAssistant, clearStream]);

  // 刷新/重开页面后按 eventId=0 重放当前 job，再继续实时 tail；旧任务无事件日志时退回最终快照。
  const resumePendingTurn = useCallback((sessionId: string) => {
    if (streamCtl.current[sessionId] || streamAcc.current[sessionId]) return;  // 本标签正在跑，不插手
    const s = sessionsRef.current.find((x) => x.id === sessionId);
    const last = s?.messages[s.messages.length - 1];
    if (!last || last.role !== 'user') return;   // 没有悬空的用户消息 = 无需恢复
    let turnId = s.pendingTurnId;
    try { turnId = sessionStorage.getItem(`easel_pending_turn:${sessionId}`) || turnId; } catch { /* use persisted id */ }
    streamAcc.current[sessionId] = { content: '', thinking: '', steps: [], questions: [] };
    setStreams((p) => ({ ...p, [sessionId]: { content: '', thinking: '', activity: '⏳ 正在接回上一轮结果…', questions: [] } }));
    typingBuf.current[sessionId] = '';
    startTypingPump(sessionId);
    if (!turnId) {
      void fetchLastTurn(sessionId).then((r) => {
        if (r.status === 'done') appendAssistant(sessionId, { role: 'assistant', content: r.text || '（无输出）' });
        clearStream(sessionId);
      }).catch(() => clearStream(sessionId));
      return;
    }
    streamCtl.current[sessionId] = streamChat(
      '', undefined, sessionId,
      (chunk) => {
        const a = streamAcc.current[sessionId]; if (!a) return;
        typingBuf.current[sessionId] = (typingBuf.current[sessionId] || '') + chunk;
        ensureTypingPump(sessionId);
      },
      (sessionKey) => {
        const waitAndFinalize = () => {
          if (typingBuf.current[sessionId]) {
            setTimeout(waitAndFinalize, 60);
            return;
          }
          const a = streamAcc.current[sessionId];
          appendAssistant(sessionId, {
            role: 'assistant', content: a?.content || '（无输出）',
            thinking: a?.thinking || undefined, activity: a?.steps.join('\n') || undefined,
          }, sessionKey);
          clearStream(sessionId);
          try { sessionStorage.removeItem(`easel_pending_turn:${sessionId}`); } catch { /* ignore */ }
        };
        waitAndFinalize();
      },
      (err) => {
        const waitAndFinalize = () => {
          if (typingBuf.current[sessionId]) {
            setTimeout(waitAndFinalize, 60);
            return;
          }
          const a = streamAcc.current[sessionId];
          appendAssistant(sessionId, { role: 'assistant', content: (a?.content || '') + `\n\nError: ${err.message}` });
          clearStream(sessionId);
        };
        waitAndFinalize();
      },
      (chunk) => { const a = streamAcc.current[sessionId]; if (a) a.thinking = (a.thinking + chunk).slice(-4000); },
      (status) => {
        const a = streamAcc.current[sessionId]; if (!a) return;
        if (a.steps[a.steps.length - 1] !== status) a.steps.push(status);
        setStreams((p) => (p[sessionId] ? { ...p, [sessionId]: { ...p[sessionId], activity: status } } : p));
      },
      () => setStreams((p) => (p[sessionId]
        ? { ...p, [sessionId]: { ...p[sessionId], activity: '⏳ 正在自动续接…' } } : p)),
      turnId,
      true,
      () => {
        // The event log may disappear after a backend restart. Prefer the
        // completed per-session snapshot; otherwise terminate stale recovery.
        void fetchLastTurn(sessionId, turnId).then((r) => {
          if (r.status === 'done') {
            appendAssistant(sessionId, { role: 'assistant', content: r.text || '（无输出）' });
          } else {
            appendAssistant(sessionId, {
              role: 'assistant',
              content: '上一轮任务记录已失效，无法继续恢复。请重新发送上一条消息。',
            });
          }
          clearStream(sessionId);
          try { sessionStorage.removeItem(`easel_pending_turn:${sessionId}`); } catch { /* ignore */ }
        }).catch(() => {
          appendAssistant(sessionId, {
            role: 'assistant', content: '上一轮任务记录已失效，请重新发送上一条消息。',
          });
          clearStream(sessionId);
        });
      },
      undefined,   // attachments: 恢复轮次无新附件
      (q) => {
        const a = streamAcc.current[sessionId]; if (!a) return;
        if (a.questions.some((x) => x.id === q.id)) return;
        if (answeredRef.current.has(q.id)) return;   // 本会话已答过：不再重现
        // 重放可能带已解决/已过期的旧问题（gateway 15s 后即清理）——先查状态只留 pending；
        // 查询失败时保留原样（宁显示不丢题）。
        void questionStatus([q.id]).then((st) => {
          const s = st[q.id]?.status;
          // 只显示仍 pending 的：answered/expired/cancelled/not_found/unknown 一律过滤
          //（unknown 通常=问题已从 gateway 清理，即已答或已过期，重放旧事件时不该重现）
          if (s && s !== 'pending' || answeredRef.current.has(q.id)) return;
          const a2 = streamAcc.current[sessionId]; if (!a2) return;
          if (a2.questions.some((x) => x.id === q.id)) return;
          a2.questions.push(q);
          setStreams((p) => (p[sessionId]
            ? { ...p, [sessionId]: { ...p[sessionId], questions: [...a2.questions] } } : p));
        });
      },
      // onHeartbeat：同上，独立的「未卡住」提示，不覆盖 activity/thinking。
      (note) => setStreams((p) => (p[sessionId] ? { ...p, [sessionId]: { ...p[sessionId], stillWorking: note } } : p)),
    );
  }, [appendAssistant, clearStream]);

  // 活跃会话确定后（含挂载首刷）尝试恢复它悬空的一轮
  useEffect(() => {
    if (activeSessionId) resumePendingTurn(activeSessionId);
  }, [activeSessionId, resumePendingTurn]);

  // 落用户消息（可选先把 messages 截断到 truncateAt）→ 启动流。retry/edit 都走这里。
  const sendUserAndStream = useCallback((
    sessionId: string,
    displayText: string,
    attachments: UploadedFile[] = [],
    legacyAgentText?: string,
    truncateAt?: number,
  ) => {
    const visible = displayText.trim();
    const agentMessage = (legacyAgentText || displayText).trim();
    if ((!agentMessage && attachments.length === 0) || streamCtl.current[sessionId]) return;
    const cur = sessionsRef.current.find((s) => s.id === sessionId);
    const persona = cur?.persona || selectedPersona || undefined;
    setSessions((prev) => {
      const next = prev.map((s) => {
        if (s.id !== sessionId) return s;
        const base = truncateAt != null ? s.messages.slice(0, truncateAt) : s.messages;
        const updated = {
          ...s,
          messages: [...base, {
            role: 'user',
            content: visible,
            ...(attachments.length ? { attachments } : {}),
            ...(legacyAgentText && legacyAgentText !== visible ? { agentContent: legacyAgentText } : {}),
          } as ChatMessage],
        };
        updateSessionTitle(updated);
        return updated;
      });
      saveSessions(next);
      return next;
    });
    startStream(sessionId, agentMessage, persona, attachments);
  }, [selectedPersona, startStream]);

  // 新建对话时预先填进输入框的内容（从「全部能力」点进来），发出第一句后就不再需要
  const [drafts, setDrafts] = useState<Record<string, ChatDraft>>({});

  const handleSendMessage = useCallback((sessionId: string, displayText: string, attachments?: UploadedFile[], agentText?: string) => {
    setDrafts((d) => { if (!d[sessionId]) return d; const n = { ...d }; delete n[sessionId]; return n; });
    sendUserAndStream(sessionId, displayText, attachments, agentText);
  }, [sendUserAndStream]);

  // 右侧作品栏，展开 / 收起记在本机。窗口窄的时候作品栏会盖住对话，所以默认收起、单独记
  const narrow = useMediaQuery('(max-width: 1200px)');
  const [wideOpen, setWideOpen] = useState(() => {
    try { return localStorage.getItem('dz_works_open') !== '0'; } catch { return true; }
  });
  const [narrowOpen, setNarrowOpen] = useState(false);
  const worksOpen = narrow ? narrowOpen : wideOpen;
  const toggleWorks = useCallback((open: boolean) => {
    if (narrow) { setNarrowOpen(open); return; }
    setWideOpen(open);
    try { localStorage.setItem('dz_works_open', open ? '1' : '0'); } catch { /* ignore */ }
  }, [narrow]);
  const openInWorks = useCallback((path: string) => {
    setOutputsJump(path);
    setCurrentPage('works');
  }, []);

  // 重试/编辑重发：从该用户消息处截断（丢弃它及其之后），用 text 重新发起。
  const handleResend = useCallback((
    sessionId: string,
    userIndex: number,
    displayText: string,
    attachments?: UploadedFile[],
    legacyAgentText?: string,
  ) => {
    sendUserAndStream(sessionId, displayText, attachments, legacyAgentText, userIndex);
  }, [sendUserAndStream]);

  // 热点「一键做成内容」：新开会话，把选题作为指令发出去，跳到对话页。
  const handleUseTopic = useCallback((title: string) => {
    const prompt = `围绕当前热点「${title}」：先判断它适不适合我的账号赛道；若合适，给 2-3 个差异化的二创角度，并把你最推荐的那条写成可直接发布的文案初稿。`;
    const ns = createSession(selectedPersona || undefined);
    setSessions((prev) => { const u = prependSession(ns, prev); saveSessions(u); return u; });
    setActiveSessionId(ns.id);
    setCurrentPage('create');
    sendUserAndStream(ns.id, prompt);
  }, [selectedPersona, sendUserAndStream]);

  const handleStopStream = useCallback((sessionId: string) => {
    streamCtl.current[sessionId]?.abort();
    // 告诉后端**真正终止**这一轮 agent 并释放会话锁——否则后端进程还在跑、占着锁，下一句会被拦
    void stopChat(sessionId).catch(() => { /* 后端可能已结束，忽略 */ });
    flushTyping(sessionId);   // 停止时立刻把队列余字吐完，保证已到内容不丢
    const a = streamAcc.current[sessionId];
    if (a && (a.content || a.thinking || a.steps.length)) {
      appendAssistant(sessionId, {
        role: 'assistant',
        content: (a.content || '') + '\n\n_（已停止）_',
        thinking: a.thinking || undefined,
        activity: a.steps.join('\n') || undefined,
      });
    }
    clearStream(sessionId);
    // 关键：清掉「本轮进行中」标记，否则下一句被判为「上一条还没跑完」拦下
    setSessions((prev) => {
      const next = prev.map((s) => (s.id === sessionId ? closeTurn({ ...s, pendingTurnId: undefined }) : s));
      saveSessions(next);
      return next;
    });
    try { sessionStorage.removeItem(`easel_pending_turn:${sessionId}`); } catch { /* ignore */ }
  }, [appendAssistant, clearStream]);

  const handleSessionRename = useCallback((id: string, title: string) => {
    const t = title.trim();
    if (!t) return;
    setSessions((prev) => {
      const next = prev.map((s) => (s.id === id ? { ...s, title: t } : s));
      saveSessions(next);
      return next;
    });
  }, []);

  const handleNewChat = useCallback(() => {
    const newSession = createSession(selectedPersona || undefined);
    setSessions((prev) => {
      const updated = prependSession(newSession, prev);
      saveSessions(updated);
      return updated;
    });
    setActiveSessionId(newSession.id);
    setCurrentPage('create');
  }, [selectedPersona]);

  const handleSessionSelect = useCallback((id: string) => {
    setActiveSessionId(id);
    const target = sessions.find(s => s.id === id);
    if (target) {
      setSelectedPersona(target.persona || '');
    }
    setCurrentPage('create');
  }, [sessions]);

  // 确认在界面里做（历史栏两步确认）：桌面 WebView 不一定支持 window.confirm
  const handleSessionDelete = useCallback((id: string) => {

    const target = sessionsRef.current.find((s) => s.id === id);
    const wasRunning = Boolean(streamCtl.current[id]);
    const stopped = wasRunning
      ? stopChat(id).catch(() => ({ stopped: false }))
      : Promise.resolve({ stopped: false });
    streamCtl.current[id]?.abort();   // 删除正在流式的会话时中止其流
    clearStream(id);
    try { sessionStorage.removeItem(`easel_pending_turn:${id}`); } catch { /* ignore */ }

    if (target?.sessionKey) {
      // Do not delete OpenClaw's session record while its agent is still
      // writing to it; the stop endpoint waits for backend cleanup first.
      void stopped.then(() => deleteRemoteSession(target.sessionKey as string)).catch(() => {});
    }

    setSessions((prev) => {
      const updated = prev.filter((s) => s.id !== id);
      saveSessions(updated);

      if (id === activeSessionId) {
        if (updated.length > 0) {
          setActiveSessionId(updated[0].id);
        } else {
          const newSession = createSession();
          updated.unshift(newSession);
          saveSessions(updated);
          setActiveSessionId(newSession.id);
        }
      }
      return updated;
    });
  }, [activeSessionId, clearStream]);

  // 首次引导：跳过（用通用模式）
  const dismissRecommend = useCallback(() => {
    localStorage.setItem(ONBOARDING_SEEN_KEY, '1');
    setShowRecommend(false);
  }, []);

  // 打开引导向导
  const openWizard = useCallback(() => {
    setShowRecommend(false);
    setShowWizard(true);
  }, []);

  // 画像创建完成
  const handleProfileCreated = useCallback((name: string) => {
    localStorage.setItem(ONBOARDING_SEEN_KEY, '1');
    setShowWizard(false);
    fetchPersonas().then((list) => {
      setPersonas(list);
      setSelectedPersona(name);
      // 用新画像开一个新会话
      const newSession = createSession(name);
      setSessions((prev) => {
        const updated = prependSession(newSession, prev);
        saveSessions(updated);
        return updated;
      });
      setActiveSessionId(newSession.id);
      navigate('create');
    }).catch(() => {});
  }, [navigate]);

  // 画像删除完成：刷新列表 + 若删的是当前选中的则清空选择
  const handleProfileDeleted = useCallback((name: string) => {
    fetchPersonas().then((list) => {
      setPersonas(list);
      setSelectedPersona((cur) => (cur === name ? '' : cur));
    }).catch(() => {});
  }, []);

  // 流式生命周期在 App，页面切换随意——ChatPage 可自由卸载/重挂，回来从 props 读流式态即可。
  const today = useToday(personasLoaded ? personas : null);
  const streamingIds = Object.keys(streams);
  const running: RunningTask[] = streamingIds.map((id) => {
    const s = sessions.find((x) => x.id === id);
    return { sessionId: id, title: s?.title || '新的创作', activity: streams[id]?.activity || '' };
  });
  const counts: NavCounts = { today: today.todos.length };

  // 从「今天」页的大输入框开始：新开一个创作，发出去，跳到 AI 创作页
  const handleStartChat = useCallback((text: string) => {
    const ns = createSession(selectedPersona || undefined);
    setSessions((prev) => { const u = prependSession(ns, prev); saveSessions(u); return u; });
    setActiveSessionId(ns.id);
    setCurrentPage('create');
    sendUserAndStream(ns.id, text);
  }, [selectedPersona, sendUserAndStream]);

  // 「全部能力」里点一项：开一个新对话，输入框里先写好开头，等用户补上要做什么
  const handleUseAbility = useCallback((skill: string, label: string) => {
    const ns = createSession(selectedPersona || undefined);
    setSessions((prev) => { const u = prependSession(ns, prev); saveSessions(u); return u; });
    setDrafts((d) => ({ ...d, [ns.id]: { text: `用「${label}」帮我做：`, skill } }));
    setActiveSessionId(ns.id);
    setCurrentPage('create');
  }, [selectedPersona]);

  const tabOf = (page: PageId) => tabs[page] ?? DEFAULT_TAB[page]!;
  const setTab = (page: PageId) => (t: TabId) => setTabs((x) => ({ ...x, [page]: t }));

  const renderPage = () => {
    switch (currentPage) {
      case 'today':
        return (
          <TodayPage
            data={today} persona={selectedPersona} running={running}
            onNavigate={navigate} onNewPersona={() => setShowWizard(true)}
            onStartChat={handleStartChat} onUseTopic={handleUseTopic} onOpenSession={handleSessionSelect} onOpenWork={openInWorks}
          />
        );
      case 'inspire':
        return (
          <TabbedPage
            title="找灵感" desc="热点、选题和爆款拆解，都在这里" tab={tabOf('inspire')} onTab={setTab('inspire')}
            tabs={[{ value: 'trends', label: '热点' }, { value: 'ideas', label: '选题库' }, { value: 'breakdown', label: '拆解爆款' }, { value: 'bench', label: '对标账号' }]}
          >
            {tabOf('inspire') === 'trends' && <TrendsView onUseTopic={handleUseTopic} />}
            {tabOf('inspire') === 'ideas' && <IdeasView onUseTopic={handleUseTopic} />}
            {tabOf('inspire') === 'breakdown' && <BreakdownView persona={selectedPersona} />}
            {tabOf('inspire') === 'bench' && (
              <ComingSoon
                title="对标账号" desc="关注几个同领域的优秀账号，他们发了新作品，搭子会第一时间告诉你，还能一键拆解。"
                points={['添加对标账号的主页链接', '新作品提醒，附带点赞、收藏数据', '一键拆解：为什么火、你能怎么借鉴']}
              />
            )}
          </TabbedPage>
        );
      case 'create':
        return (
          <CreateFrame
            sessions={sessions} activeId={activeSessionId} streamingIds={streamingIds}
            onSelect={handleSessionSelect} onNew={handleNewChat} onDelete={handleSessionDelete} onRename={handleSessionRename}
            onAllSkills={() => setCurrentPage('skills')}
            worksOpen={worksOpen} onOpenWorks={() => toggleWorks(true)}
            works={activeSession && (activeSession.messages.length > 0 || streams[activeSession.id]) && (
              <WorksPanel
                key={activeSession.id} session={activeSession} stream={streams[activeSession.id]}
                onCollapse={() => toggleWorks(false)} onOpenInWorks={openInWorks}
              />
            )}
          >
            {activeSession ? (
          <ChatPage
            key={activeSession.id}
            session={activeSession}
            stream={streams[activeSession.id]}
            draft={drafts[activeSession.id]}
            onAllSkills={() => setCurrentPage('skills')}
            onSend={(displayText, attachments, agentText) => handleSendMessage(activeSession.id, displayText, attachments, agentText)}
            onStop={() => handleStopStream(activeSession.id)}
            onResend={(userIndex, displayText, attachments, legacyAgentText) => handleResend(
              activeSession.id, userIndex, displayText, attachments, legacyAgentText,
            )}
            onQuestionAnswered={(qid) => {
              answeredRef.current.add(qid);
              // 已答题从流式状态中移除——切走/切回会话都不再重现（组件内部 state 会在重挂时清零，只藏不移除没用）
              const a = streamAcc.current[activeSession.id];
              if (a) {
                const before = a.questions.length;
                const kept = a.questions.filter((q) => q.id !== qid);
                if (kept.length !== before) {
                  a.questions = kept;
                  setStreams((p) => {
                    const cur = p[activeSession.id];
                    if (!cur) return p;
                    return { ...p, [activeSession.id]: { ...cur, questions: [...kept] } };
                  });
                }
              }
            }}
          />
) : null}
          </CreateFrame>
        );
      case 'skills':
        return <AbilitiesPage onUse={handleUseAbility} onBack={() => setCurrentPage('create')} />;
      case 'works':
        return (
          <WorksLibrary
            jumpPath={outputsJump} onJumpHandled={clearOutputsJump}
            onPublish={(d) => { savePublishDraft({ ...loadPublishDraft(), ...d }); navigate('publish', 'center'); }}
          />
        );
      case 'publish':
        return (
          <TabbedPage
            title="发布" desc="一份内容，适配后发到多个平台" tab={tabOf('publish')} onTab={setTab('publish')}
            tabs={[{ value: 'center', label: '发布中心' }, { value: 'calendar', label: '内容日历' }, { value: 'records', label: '发布记录' }]}
          >
            {tabOf('publish') === 'center' && <PublishPage persona={selectedPersona} />}
            {tabOf('publish') === 'calendar' && <CalendarPage />}
            {tabOf('publish') === 'records' && (
              <ComingSoon
                title="发布记录" desc="每一次发布的进度和结果都记在这里，失败了能看到原因，一键重试。"
                points={['正在发布、已发布、失败，一目了然', '失败原因用大白话说清楚', '平台要求验证时及时提醒你']}
              />
            )}
          </TabbedPage>
        );
      case 'engage':
        return (
          <ComingSoon
            title="互动" desc="你作品下的新评论和私信，会汇总到这里。搭子按你的账号定位起草回复，你看过点确认才会发出去。"
            points={['小红书、抖音、快手的新评论提醒', 'AI 起草回复，你确认后才发送', '私信汇总，不错过合作咨询']}
            action={{ label: '先去登录平台账号', onClick: () => navigate('accounts', 'platforms') }}
          />
        );
      case 'data':
        return (
          <ComingSoon
            title="数据" desc="粉丝和每篇作品的表现，搭子帮你看懂数据，告诉你下一篇该怎么做。"
            points={['粉丝、点赞、收藏的变化趋势', '哪篇作品表现最好、为什么', '每周复盘建议']}
            action={{ label: '先去登录平台账号', onClick: () => navigate('accounts', 'platforms') }}
          />
        );
      case 'accounts':
        return (
          <TabbedPage
            title="账号与定位" desc="登录发布平台，告诉搭子你的账号是做什么的" tab={tabOf('accounts')} onTab={setTab('accounts')}
            tabs={[{ value: 'platforms', label: '平台账号' }, { value: 'persona', label: '账号定位' }]}
          >
            {tabOf('accounts') === 'platforms' && <AccountsPage />}
            {tabOf('accounts') === 'persona' && (
              <ProfilePage persona={selectedPersona} personas={personas} onSelect={handlePersonaChange} onNewProfile={() => setShowWizard(true)} onDeleted={handleProfileDeleted} />
            )}
          </TabbedPage>
        );
      case 'settings':
        return <SettingsPage onReplayGuide={() => setShowRecommend(true)} />;
      default:
        return null;
    }
  };

  const handlePersonaChange = useCallback((persona: string) => {
    setSelectedPersona(persona);
    // 修复：选/切画像不再新建空会话丢上下文。就地把当前会话的画像设为新选的、
    // 保留会话 id 与历史（画像只是每轮的系统前缀，中途换安全）。想开新线程用「New Chat」。
    const cur = sessionsRef.current.find((s) => s.id === activeSessionId);
    if (cur) {
      setSessions((prev) => {
        const updated = prev.map((s) =>
          s.id === activeSessionId ? { ...s, persona: persona || undefined } : s);
        saveSessions(updated);
        return updated;
      });
    } else {
      // 无活跃会话（极少）才新建
      const ns = createSession(persona || undefined);
      setSessions((prev) => { const u = prependSession(ns, prev); saveSessions(u); return u; });
      setActiveSessionId(ns.id);
    }
  }, [activeSessionId]);

  return (
    <div className="app-layout">
      <Nav
        page={currentPage} onNavigate={navigate}
        personas={personas} persona={selectedPersona}
        onPersonaChange={handlePersonaChange} onNewPersona={() => setShowWizard(true)}
        counts={counts} membership={null}
        gatewayOnline={gatewayStatus === 'connecting' ? null : gatewayStatus === 'connected'}
      />
      <main className="main-content">
        <div className="page-host">
          {renderPage()}
        </div>
      </main>

      {/* 首次使用：欢迎 → 3 步问答 */}
      {showRecommend && <Welcome onStart={openWizard} onSkip={dismissRecommend} />}

      {/* 画像配置向导 */}
      {showWizard && (
        <Wizard onClose={() => setShowWizard(false)} onCreated={handleProfileCreated} />
      )}

    </div>
  );
}
