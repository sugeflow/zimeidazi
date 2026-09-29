import { useState, useRef, useEffect } from 'react';
import MessageBubble from './MessageBubble';
import QuestionCards from './QuestionCards';
import BrushEntry from './BrushEntry';
import type { ChatSession, ChatMessage, StreamState } from '../lib/store';
import { uploadFiles, adoptOversize } from '../lib/api';
import type { UploadedFile } from '../lib/api';
import { IconArrowUp, IconStop, IconPlus, IconFile } from './icons';
import { greeting as dayGreeting } from '../lib/format';
import { TEMPLATES } from '../lib/templates';
import { alertDialog } from '../ui/dialog';
import { Button, Mascot } from '../ui';

/** 打开对话时预先填好的输入；skill 是从「全部能力」点进来时要用的技能 ID */
export interface ChatDraft { text: string; skill?: string }

interface ChatPageProps {
  session: ChatSession;
  stream?: StreamState;          // 进行中的流式态（来自 App，切页也不丢）
  draft?: ChatDraft;
  onAllSkills: () => void;
  onSend: (displayText: string, attachments?: UploadedFile[], agentText?: string) => void;
  onStop: () => void;
  onResend: (
    userIndex: number,
    displayText: string,
    attachments?: UploadedFile[],
    legacyAgentText?: string,
  ) => void; // 重试：仅对最后一轮
  onQuestionAnswered?: (questionId: string) => void;   // 某道问答题提交成功（App 记录答过，重放不再出现）
}

function greeting(): string {
  const h = new Date().getHours();
  const g = dayGreeting(h);
  return `${g}，今天做点什么？`;
}

export default function ChatPage({ session, stream, draft, onAllSkills, onSend, onStop, onResend, onQuestionAnswered }: ChatPageProps) {
  const [input, setInput] = useState(draft?.text ?? '');
  const skillRef = useRef(draft?.skill);
  const [attachments, setAttachments] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [maxMb, setMaxMb] = useState(50);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isStreaming = !!stream;
  const isEmpty = session.messages.length === 0 && !isStreaming;

  useEffect(() => {
    fetch('/api/upload/limits').then((r) => r.json())
      .then((d) => { if (d?.max_mb) setMaxMb(d.max_mb); }).catch(() => {});
  }, []);

  const doUpload = async (fs: FileList | File[]) => {
    const arr = Array.from(fs);
    if (!arr.length) return;
    const cap = maxMb * 1024 * 1024;
    const big = arr.filter((f) => f.size > cap);
    const small = arr.filter((f) => f.size <= cap);

    if (big.length) {
      // 超限：不走上传通道，复制进收件箱后作为普通附件（界面零新增元素）
      setUploading(true);
      try {
        const saved = await adoptOversize(big, session.id);
        setAttachments((a) => [...a, ...saved]);
      } catch (err) {
        await alertDialog((err as Error).message || '大文件处理失败');
      } finally {
        setUploading(false);
      }
    }
    if (!small.length) return;
    setUploading(true);
    try {
      const saved = await uploadFiles(small, session.id);
      setAttachments((a) => [...a, ...saved]);
    } catch (err) {
      await alertDialog((err as Error).message || '上传失败');
    } finally {
      setUploading(false);
    }
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    if (e.dataTransfer.files?.length) doUpload(e.dataTransfer.files);
  };
  const onPaste = (e: React.ClipboardEvent) => {
    if (e.clipboardData.files?.length) { e.preventDefault(); doUpload(e.clipboardData.files); }
  };
  const removeAttachment = (path: string) => setAttachments((a) => a.filter((x) => x.path !== path));

  useEffect(() => {
    if (!isEmpty) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [session.messages, stream?.content, stream?.thinking, stream?.activity, stream?.stillWorking, isEmpty]);

  // 带着预填内容打开：光标放到最后，接着写就行
  useEffect(() => {
    const el = textareaRef.current;
    if (draft?.text && el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
  }, [draft?.text]);

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 180) + 'px';
    }
  }, [input]);

  const handleSend = () => {
    const trimmed = input.trim();
    if ((!trimmed && attachments.length === 0) || isStreaming || uploading) return;
    // 附件通过结构化字段发送；用户消息气泡只显示用户实际输入的文字。
    // 从「全部能力」点进来的第一句，额外告诉搭子用哪个技能（界面上不显示）
    const skill = skillRef.current;
    skillRef.current = undefined;
    onSend(trimmed, attachments, skill && trimmed ? `${trimmed}\n\n（请使用 ${skill} 技能完成）` : undefined);
    setInput('');
    setAttachments([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 中文输入法选词时按回车不能发送
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      handleSend();
    }
  };

  const inputBox = (hero: boolean) => (
    <div className={`composer ${hero ? 'composer-hero' : ''} ${dragOver ? 'composer-drag' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
      onDrop={onDrop}>
      {attachments.length > 0 && (
        <div className="composer-attachments">
          {attachments.map((a) => (
            <span key={a.path} className="attach-chip" title={a.path}>
              <IconFile size={12} /> <span className="attach-name">{a.name}</span>
              <button className="attach-x" onClick={() => removeAttachment(a.path)} title="移除">×</button>
            </span>
          ))}
        </div>
      )}
      <div className="composer-top">
        <BrushEntry onPick={(t) => { setInput(t); requestAnimationFrame(() => textareaRef.current?.focus()); }} />
        <textarea
          ref={textareaRef}
          className="chat-input"
          placeholder={dragOver ? '松手上传素材…' : hero ? '比如：帮我写一篇国庆去成都玩的小红书图文，配 6 张卡片' : '发消息…（Enter 发送，Shift+Enter 换行，可拖入/粘贴素材）'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={onPaste}
          rows={1}
          autoFocus={hero}
        />
      </div>
      <input ref={fileInputRef} type="file" multiple hidden
        onChange={(e) => { if (e.target.files) doUpload(e.target.files); e.target.value = ''; }} />
      <div className="composer-bar">
        <button className="composer-attach-btn" onClick={() => fileInputRef.current?.click()}
          disabled={isStreaming || uploading} title={`添加素材（图片/文档）；超过 ${maxMb}MB 的大文件将自动存为本地素材（不走上传）`}>
          <IconPlus size={15} /> {uploading ? '上传中…' : '素材'}
        </button>
        <span className="composer-hint">{isStreaming ? '生成中…' : 'Enter 发送 · Shift+Enter 换行'}</span>
        {isStreaming ? (
          <button className="send-btn" onClick={onStop} title="停止生成"><IconStop size={15} /></button>
        ) : (
          <button className="send-btn" onClick={handleSend} disabled={(!input.trim() && !attachments.length) || uploading} title="发送"><IconArrowUp size={17} /></button>
        )}
      </div>
    </div>
  );

  // 模板只填进输入框，用户接着写主题再发送
  const fill = (text: string) => {
    setInput(text);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
    });
  };

  // ---- 空态：模板 ----
  if (isEmpty) {
    return (
      <div className="chat-page">
        <div className="dz-create-empty">
          <div className="dz-create-empty__hi">
            <Mascot pose="welcome" size={72} />
            <div>
              <h1 className="dz-h1">{greeting()}</h1>
              <p className="dz-sub">说说想做什么，或者从下面挑一个模板开始。{session.persona ? `会按「${session.persona}」的定位来写。` : ''}</p>
            </div>
          </div>
          {inputBox(true)}
          <section>
            <div className="dz-sec-head">
              <h2 className="dz-h2">从模板开始</h2>
              <Button variant="link" onClick={onAllSkills}>看看搭子的全部能力 →</Button>
            </div>
            <div className="dz-tpl-grid">
              {TEMPLATES.map((t) => (
                <button key={t.id} className="dz-tpl" onClick={() => fill(t.text)}>
                  <span className="dz-tpl__emoji" aria-hidden>{t.emoji}</span>
                  <b>{t.label}</b>
                  <span>{t.desc}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    );
  }

  // ---- 对话态 ----
  const displayMessages: ChatMessage[] = [...session.messages];
  if (isStreaming) displayMessages.push({ role: 'assistant', content: stream!.content || '' });

  return (
    <div className="chat-page">
      <div className="chat-messages">
        <div className="chat-thread">
          {displayMessages.map((msg, i) => {
            const isLast = i === displayMessages.length - 1;
            const live = isStreaming && isLast && msg.role === 'assistant';
            const isFinal = !live && i < session.messages.length;
            let actions;
            if (isFinal) {
              const copy = () => navigator.clipboard?.writeText(msg.content);
              // 只允许对「最后一轮」重试，契合 OpenClaw append-only 模型（不改写历史）；已移除编辑
              const isLastFinal = i === session.messages.length - 1;
              if (msg.role === 'user') {
                actions = {
                  onCopy: copy,
                  onRetry: isLastFinal
                    ? () => onResend(i, msg.content, msg.attachments, msg.agentContent)
                    : undefined,
                  canModify: !isStreaming,
                };
              } else {
                const pi = i - 1;
                const prevUser = pi >= 0 && session.messages[pi]?.role === 'user' ? session.messages[pi] : null;
                actions = {
                  onCopy: copy,
                  onRetry: (isLastFinal && prevUser)
                    ? () => onResend(pi, prevUser.content, prevUser.attachments, prevUser.agentContent)
                    : undefined,
                  canModify: !isStreaming,
                };
              }
            }
            return (
              <MessageBubble
                key={`${i}-${msg.role}`}
                message={msg}
                isStreaming={live}
                thinking={live ? stream!.thinking : ''}
                activity={live ? stream!.activity : ''}
                stillWorking={live ? stream!.stillWorking : ''}
                actions={actions}
              />
            );
          })}
          {isStreaming && (stream!.questions?.length ?? 0) > 0 && (
            <QuestionCards questions={stream!.questions || []} onDone={(qid) => onQuestionAnswered?.(qid)} />
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="chat-input-area">
        <div className="chat-input-inner">{inputBox(false)}</div>
      </div>
    </div>
  );
}
