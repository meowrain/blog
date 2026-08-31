// Blog Admin Panel — vanilla JS, no build step.
// Scripts are loaded with `defer`, so the DOM is ready and CDN libs (if present)
// are already evaluated by the time this file runs.

const API_BASE = '/api';
const PAGE_SIZE = 20;
const BACKUP_PAGE_SIZE = 25;

const state = {
    view: 'articles',
    page: 1,
    totalPages: 1,
    total: 0,
    filters: { search: '', category: '', tag: '', draft: '' },
    pageArticles: [],
    batchMode: false,
    selected: new Set(),
    backupPage: 1,
    backupTotalPages: 1,
};

const meta = { categories: [], tags: [] };

const $ = (id) => document.getElementById(id);

const dom = {
    articleList: $('article-list'),
    pagination: $('pagination'),
    articlesSummary: $('articles-summary'),
    categoryList: $('category-list'),
    tagList: $('tag-list'),
    backupTableWrap: $('backup-table-wrap'),
    backupPagination: $('backup-pagination'),
    backupsSummary: $('backups-summary'),
    searchInput: $('search-input'),
    categoryFilter: $('category-filter'),
    tagFilter: $('tag-filter'),
    draftFilter: $('draft-filter'),
    editorModal: $('editor-modal'),
    editorTitle: $('editor-title'),
    editorPath: $('editor-path'),
    articleForm: $('article-form'),
    articleContent: $('article-content'),
    saveBtn: $('save-article-btn'),
    dirtyHint: $('dirty-hint'),
    previewModal: $('preview-modal'),
    previewTitle: $('preview-title'),
    previewMeta: $('preview-meta'),
    previewContent: $('preview-content'),
    dialogModal: $('dialog-modal'),
    dialogTitle: $('dialog-title'),
    dialogMessage: $('dialog-message'),
    dialogFields: $('dialog-fields'),
    dialogConfirm: $('dialog-confirm'),
    dialogCancel: $('dialog-cancel'),
    dialogClose: $('dialog-close'),
    toastContainer: $('toast-container'),
    batchToolbar: $('batch-toolbar'),
    batchCount: $('batch-count'),
    batchSelectAll: $('batch-select-all'),
    batchModeBtn: $('batch-mode-btn'),
    mdToolbar: $('md-toolbar'),
    mdPreview: $('md-preview'),
    mdPreviewToggle: $('md-preview-toggle'),
    mdEditorBody: document.querySelector('.md-editor-body'),
    categorySearch: $('category-search'),
    tagSearch: $('tag-search'),
    tagSort: $('tag-sort'),
    imageInput: $('article-image'),
    imagePreview: $('image-preview'),
    imagePreviewImg: $('image-preview-img'),
    imagePreviewError: $('image-preview-error'),
    categoryPickerMenu: null,
};

const formFields = {
    title: $('article-title'),
    category: $('article-category'),
    tags: $('article-tags'),
    image: $('article-image'),
    description: $('article-description'),
    lang: $('article-lang'),
    draft: $('article-draft'),
};

let activeCategoryOption = -1;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatCategoryDisplay(category = '') {
    return String(category)
        .replace(/[\\/]+/g, '/')
        .split('/')
        .map((s) => s.trim())
        .filter(Boolean)
        .join(' > ');
}

function normalizeCategoryPath(category = '') {
    return String(category)
        .replace(/>/g, '/')
        .replace(/[\\/]+/g, '/')
        .split('/')
        .map((s) => s.trim())
        .filter(Boolean)
        .join('/');
}

function parseTags(raw = '') {
    return raw
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean);
}

function debounce(fn, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn.apply(this, args), wait);
    };
}

function formatDate(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('zh-CN');
}

function formatDateTime(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN');
}

function relativeTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    const diff = Date.now() - date.getTime();
    const minute = 60 * 1000;
    if (diff < minute) return '刚刚';
    if (diff < 60 * minute) return `${Math.floor(diff / minute)} 分钟前`;
    if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} 小时前`;
    if (diff < 30 * 24 * 60 * minute) return `${Math.floor(diff / (24 * 60 * minute))} 天前`;
    return date.toLocaleDateString('zh-CN');
}

function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function apiRequest(endpoint, options = {}) {
    const response = await fetch(`${API_BASE}${endpoint}`, {
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options,
    });

    if (!response.ok) {
        const body = await response.json().catch(() => ({ message: response.statusText }));
        const message = body?.message || body?.error || '请求失败';
        const error = new Error(Array.isArray(message) ? message.join('；') : message);
        error.status = response.status;
        throw error;
    }

    if (response.status === 204) return null;
    const text = await response.text();
    return text ? JSON.parse(text) : null;
}

// ---------------------------------------------------------------------------
// Markdown rendering (preview is sanitized: article content is user-authored)
// ---------------------------------------------------------------------------

const ALLOWED_TAGS = new Set([
    'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins', 'mark', 'small',
    'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
    'a', 'img', 'figure', 'figcaption', 'div', 'span', 'sup', 'sub', 'kbd',
    'details', 'summary', 'input',
]);

const DROP_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'form', 'base']);

const GLOBAL_ATTRS = new Set([
    'class', 'title', 'id', 'align', 'colspan', 'rowspan', 'start', 'type', 'checked', 'disabled', 'data-lang',
]);
const TAG_ATTRS = {
    a: new Set(['href', 'target', 'rel']),
    img: new Set(['src', 'alt', 'loading']),
};
const SAFE_URL_RE = /^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/|[^:]*$)/i;

function sanitizeHtml(html) {
    const template = document.createElement('template');
    template.innerHTML = html;

    const walk = (node) => {
        [...node.children].forEach((child) => {
            const tag = child.tagName.toLowerCase();

            if (!ALLOWED_TAGS.has(tag)) {
                if (DROP_TAGS.has(tag)) {
                    child.remove();
                    return;
                }
                walk(child);
                child.replaceWith(...child.childNodes);
                return;
            }

            [...child.attributes].forEach((attr) => {
                const name = attr.name.toLowerCase();
                const allowedForTag = TAG_ATTRS[tag];
                const keep = !name.startsWith('on')
                    && (GLOBAL_ATTRS.has(name) || (allowedForTag && allowedForTag.has(name)));
                if (!keep) {
                    child.removeAttribute(attr.name);
                    return;
                }
                if ((name === 'href' || name === 'src') && !SAFE_URL_RE.test(attr.value.trim())) {
                    child.removeAttribute(attr.name);
                }
            });

            if (tag === 'a') {
                if (!child.hasAttribute('href')) {
                    child.removeAttribute('target');
                    child.removeAttribute('rel');
                } else if (child.getAttribute('target') === '_blank') {
                    child.setAttribute('rel', 'noopener noreferrer');
                }
            }

            if (tag === 'input' && child.getAttribute('type') !== 'checkbox') {
                child.remove();
                return;
            }

            walk(child);
        });
    };

    walk(template.content);
    return template.innerHTML;
}

function highlightCodeBlocks(container) {
    if (!window.hljs) return;
    container.querySelectorAll('pre code').forEach((block) => {
        try {
            window.hljs.highlightElement(block);
        } catch {
            // Highlighting is cosmetic; never let it break rendering.
        }
    });
}

function renderMarkdownInto(container, markdown) {
    const raw = markdown ?? '';
    if (window.marked?.parse) {
        container.innerHTML = sanitizeHtml(window.marked.parse(raw));
        highlightCodeBlocks(container);
        return;
    }
    container.innerHTML = `<pre>${escapeHtml(raw)}</pre>`;
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

function showToast(message, options = {}) {
    const { type = 'success', duration = 2800, action = null } = options;
    if (!dom.toastContainer) return;

    const key = `${type}:${message}`;
    dom.toastContainer.querySelectorAll('.toast').forEach((toast) => {
        if (toast.dataset.key === key) toast.remove();
    });

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.dataset.key = key;

    const text = document.createElement('span');
    text.className = 'toast-text';
    text.textContent = message;
    toast.appendChild(text);

    let timer = null;
    const dismiss = () => {
        if (!toast.isConnected) return;
        clearTimeout(timer);
        toast.style.animation = 'toast-out 160ms ease forwards';
        setTimeout(() => toast.remove(), 180);
    };

    if (action) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'toast-action';
        button.textContent = action.label;
        button.addEventListener('click', () => {
            dismiss();
            action.onClick();
        });
        toast.appendChild(button);
    }

    toast.addEventListener('click', dismiss);
    dom.toastContainer.appendChild(toast);
    timer = setTimeout(dismiss, action ? Math.max(duration, 6000) : duration);
}

// ---------------------------------------------------------------------------
// Dialog (replaces window.prompt / window.confirm)
// ---------------------------------------------------------------------------

let activeDialog = null;
let previouslyFocused = null;

function openDialog(config) {
    const {
        title = '提示',
        message = '',
        fields = [],
        confirmText = '确定',
        cancelText = '取消',
        danger = false,
        resolveOnBackdrop = true,
        validate = null,
    } = config;

    if (activeDialog) activeDialog.resolve({ ok: false, values: {} });

    return new Promise((resolve) => {
        const values = {};
        dom.dialogFields.innerHTML = '';
        dom.dialogTitle.textContent = title;

        dom.dialogMessage.textContent = message;
        dom.dialogMessage.hidden = !message;

        dom.dialogConfirm.textContent = confirmText;
        dom.dialogConfirm.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
        dom.dialogCancel.textContent = cancelText;

        const errorNode = (field) => {
            const node = document.createElement('span');
            node.className = 'dialog-error';
            node.hidden = true;
            node.textContent = field.requiredMessage || '此项为必填';
            field._errorNode = node;
            return node;
        };

        fields.forEach((field) => {
            if (field.type === 'note') {
                const note = document.createElement('p');
                note.className = 'dialog-note';
                note.textContent = field.text || '';
                dom.dialogFields.appendChild(note);
                return;
            }

            const wrap = document.createElement('div');
            wrap.className = 'dialog-field';
            field._wrap = wrap;
            const label = document.createElement('label');
            label.textContent = field.label || '';
            if (field.label) label.htmlFor = `dialog-field-${field.key}`;
            wrap.appendChild(label);

            if (field.type === 'select') {
                const select = document.createElement('select');
                select.id = `dialog-field-${field.key}`;
                (field.options || []).forEach((opt) => {
                    const option = document.createElement('option');
                    option.value = opt.value;
                    option.textContent = opt.label;
                    select.appendChild(option);
                });
                select.value = field.value ?? (field.options?.[0]?.value ?? '');
                values[field.key] = select.value;
                select.addEventListener('change', () => {
                    values[field.key] = select.value;
                    field.onChange?.(select.value, close);
                });
                field._input = select;
                wrap.appendChild(select);
            } else if (field.type === 'radio') {
                const group = document.createElement('div');
                group.className = 'dialog-radio';
                (field.options || []).forEach((opt, index) => {
                    const item = document.createElement('label');
                    const input = document.createElement('input');
                    input.type = 'radio';
                    input.name = `dialog-radio-${field.key}`;
                    input.value = opt.value;
                    input.checked = (field.value ?? field.options?.[0]?.value) === opt.value;
                    if (input.checked) values[field.key] = opt.value;
                    input.addEventListener('change', () => {
                        values[field.key] = opt.value;
                        field.onChange?.(opt.value, close);
                    });
                    item.appendChild(input);
                    item.appendChild(document.createTextNode(` ${opt.label}`));
                    group.appendChild(item);
                    if (index === 0) field._input = input;
                });
                wrap.appendChild(group);
            } else {
                const input = document.createElement('input');
                input.type = 'text';
                input.id = `dialog-field-${field.key}`;
                input.value = field.value ?? '';
                input.placeholder = field.placeholder || '';
                if (field.datalistId) input.setAttribute('list', field.datalistId);
                values[field.key] = input.value;
                input.addEventListener('input', () => { values[field.key] = input.value; });
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        confirmAction();
                    }
                });
                field._input = input;
                wrap.appendChild(input);
            }

            if (field.hint) {
                const hint = document.createElement('span');
                hint.className = 'dialog-hint';
                hint.textContent = field.hint;
                wrap.appendChild(hint);
            }
            if (field.required) wrap.appendChild(errorNode(field));

            dom.dialogFields.appendChild(wrap);
        });

        const clearErrors = () => fields.forEach((f) => { if (f._errorNode) f._errorNode.hidden = true; });
        const showError = (field) => {
            if (field._errorNode) {
                field._errorNode.hidden = false;
                field._input?.focus();
            }
        };

        function close(result) {
            if (!activeDialog || activeDialog.resolve !== resolve) return;
            dom.dialogModal.classList.remove('active');
            dom.dialogModal.removeEventListener('click', onBackdrop);
            document.removeEventListener('keydown', onKeydown, true);
            activeDialog = null;
            previouslyFocused?.focus?.();
            resolve(result);
        }

        function confirmAction() {
            clearErrors();
            for (const field of fields) {
                if (field.required && !String(values[field.key] ?? '').trim()) {
                    showError(field);
                    return;
                }
            }
            const problem = validate ? validate(values) : null;
            if (problem) {
                const field = fields.find((f) => f.key === problem.field);
                if (field) {
                    if (!field._errorNode) {
                        const node = errorNode(field);
                        field._wrap?.appendChild(node);
                    }
                    field._errorNode.textContent = problem.message;
                    showError(field);
                } else {
                    showToast(problem.message, { type: 'error' });
                }
                return;
            }
            close({ ok: true, values });
        }

        function onKeydown(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close({ ok: false, values });
            }
        }

        function onBackdrop(e) {
            if (e.target === dom.dialogModal && resolveOnBackdrop) close({ ok: false, values });
        }

        activeDialog = { resolve, close: () => close({ ok: false, values }) };

        dom.dialogConfirm.onclick = confirmAction;
        dom.dialogCancel.onclick = () => close({ ok: false, values });
        dom.dialogClose.onclick = () => close({ ok: false, values });
        dom.dialogModal.addEventListener('click', onBackdrop);
        document.addEventListener('keydown', onKeydown, true);

        previouslyFocused = document.activeElement;
        dom.dialogModal.classList.add('active');

        const first = fields.find((f) => f._input && f.type !== 'radio');
        if (first?._input) {
            first._input.focus();
            if (first.type !== 'select') first._input.select?.();
        } else {
            dom.dialogConfirm.focus();
        }
    });
}

async function askText(title, label, { placeholder = '', value = '', required = true, datalistId = '', hint = '' } = {}) {
    const field = { key: 'value', type: 'text', label, placeholder, value, required, datalistId, hint };
    const { ok, values } = await openDialog({ title, fields: [field], confirmText: '确定' });
    if (!ok) return null;
    const result = String(values.value ?? '').trim();
    return result || null;
}

function rememberUrl(label) {
    try { localStorage.setItem('admin:lastUrl', label); } catch { /* storage may be unavailable */ }
}

async function askUrl(title, label, placeholder = 'https://') {
    let stored = '';
    try { stored = localStorage.getItem('admin:lastUrl') || ''; } catch { /* ignore */ }
    const result = await askText(title, label, { placeholder, value: stored });
    if (result) rememberUrl(result);
    return result;
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

const editor = {
    cm: null,
    usesCodeMirror: false,
    snapshot: null,
    saving: false,
    path: null,
};

let previewVisible = true;

function initEditor() {
    const textarea = dom.articleContent;
    if (!window.CodeMirror) {
        degradeToPlainTextarea('Markdown 编辑器加载失败，已切换为纯文本模式');
        return;
    }
    try {
        editor.cm = window.CodeMirror.fromTextArea(textarea, {
            mode: { name: 'markdown', json: true, fencedCodeBlocks: true },
            theme: 'dracula',
            lineNumbers: true,
            lineWrapping: true,
        });
        editor.usesCodeMirror = true;
        editor.cm.on('change', debounce(() => { renderPreview(); markDirtyState(); }, 150));
    } catch {
        editor.cm = null;
        degradeToPlainTextarea('Markdown 编辑器初始化失败，已切换为纯文本模式');
    }
}

function degradeToPlainTextarea(message) {
    editor.usesCodeMirror = false;
    const textarea = dom.articleContent;
    textarea.classList.add('plain-textarea');
    textarea.rows = 18;
    textarea.addEventListener('input', debounce(renderPreview, 150));
    showToast(message, { type: 'info', duration: 4000 });
}

function getContent() {
    return editor.cm ? editor.cm.getValue() : dom.articleContent.value;
}

function setContent(text) {
    if (editor.cm) {
        editor.cm.setValue(text ?? '');
        return;
    }
    dom.articleContent.value = text ?? '';
}

function readFormValues() {
    return {
        title: formFields.title.value,
        category: formFields.category.value,
        tags: formFields.tags.value,
        image: formFields.image.value,
        description: formFields.description.value,
        lang: formFields.lang.value,
        draft: formFields.draft.checked,
        content: getContent(),
    };
}

function snapshotEditor() {
    editor.snapshot = readFormValues();
    setDirtyVisible(false);
}

function isEditorDirty() {
    if (!editor.snapshot) return false;
    const current = readFormValues();
    return Object.keys(current).some((key) => current[key] !== editor.snapshot[key]);
}

function setDirtyVisible(visible) {
    if (dom.dirtyHint) dom.dirtyHint.hidden = !visible;
}

function markDirtyState() {
    setDirtyVisible(isEditorDirty());
}

function refreshEditorLayout() {
    requestAnimationFrame(() => {
        editor.cm?.refresh();
        renderPreview();
    });
}

function renderPreview() {
    if (!dom.mdPreview || !previewVisible) return;
    renderMarkdownInto(dom.mdPreview, getContent());
}

function fillEditor(article, path) {
    editor.path = path;
    dom.editorTitle.textContent = '编辑文章';
    if (dom.editorPath) {
        dom.editorPath.textContent = path;
        dom.editorPath.title = path;
    }

    formFields.title.value = article.frontmatter.title ?? '';
    formFields.category.value = formatCategoryDisplay(article.frontmatter.category || '');
    formFields.tags.value = (article.frontmatter.tags || []).join(', ');
    formFields.image.value = article.frontmatter.image || '';
    formFields.description.value = article.frontmatter.description || '';
    formFields.lang.value = article.frontmatter.lang || '';
    formFields.draft.checked = Boolean(article.frontmatter.draft);
    setContent(article.content ?? '');
    updateImagePreview();

    dom.editorModal.classList.add('active');
    refreshEditorLayout();
    snapshotEditor();
    formFields.title.focus();
}

async function openEditorForPath(path) {
    try {
        const article = await apiRequest(`/articles/${encodeURIComponent(path)}`);
        fillEditor(article, path);
    } catch (error) {
        showToast(`加载文章失败：${error.message}`, { type: 'error', duration: 4000 });
    }
}

function openEditorForNew() {
    editor.path = null;
    dom.editorTitle.textContent = '新建文章';
    if (dom.editorPath) {
        dom.editorPath.textContent = '尚未保存';
        dom.editorPath.title = '保存后根据标题与分类生成文件路径';
    }
    dom.articleForm.reset();
    formFields.draft.checked = false;
    setContent('');
    updateImagePreview();

    dom.editorModal.classList.add('active');
    refreshEditorLayout();
    snapshotEditor();
    formFields.title.focus();
}

async function attemptCloseEditor() {
    if (!isEditorDirty()) {
        dom.editorModal.classList.remove('active');
        editor.path = null;
        return;
    }
    const { ok } = await openDialog({
        title: '有未保存的更改',
        message: '关闭后本次编辑的内容将丢失。',
        confirmText: '放弃修改',
        cancelText: '继续编辑',
        danger: true,
    });
    if (ok) {
        dom.editorModal.classList.remove('active');
        editor.path = null;
    }
}

function updateImagePreview() {
    if (!dom.imagePreview) return;
    const url = formFields.image.value.trim();
    if (!url) {
        dom.imagePreview.hidden = true;
        dom.imagePreviewError.hidden = true;
        dom.imagePreviewImg.removeAttribute('src');
        return;
    }
    dom.imagePreview.hidden = false;
    dom.imagePreviewError.hidden = true;
    dom.imagePreviewImg.src = url;
}

async function saveArticle() {
    if (editor.saving) return;

    const raw = readFormValues();
    if (!raw.title.trim()) {
        formFields.title.focus();
        showToast('请填写标题', { type: 'error' });
        return;
    }

    const payload = {
        title: raw.title.trim(),
        category: raw.category ? formatCategoryDisplay(raw.category) : '',
        tags: parseTags(raw.tags),
        image: raw.image.trim(),
        description: raw.description.trim(),
        lang: raw.lang.trim(),
        draft: raw.draft,
        content: raw.content,
    };

    const isEditing = Boolean(editor.path);
    editor.saving = true;
    if (dom.saveBtn) {
        dom.saveBtn.disabled = true;
        dom.saveBtn.textContent = '保存中…';
    }

    try {
        if (isEditing) {
            await apiRequest(`/articles/${encodeURIComponent(editor.path)}`, {
                method: 'PATCH',
                body: JSON.stringify({
                    ...payload,
                    newCategory: normalizeCategoryPath(raw.category),
                }),
            });
        } else {
            await apiRequest('/articles', {
                method: 'POST',
                body: JSON.stringify({ ...payload, category: raw.category.trim() }),
            });
        }

        dom.editorModal.classList.remove('active');
        editor.path = null;
        editor.snapshot = null;
        await loadArticles({ silent: true });
        refreshMeta({ silent: true });
        showToast(isEditing ? '文章已更新' : '文章已创建');
    } catch (error) {
        showToast(`保存失败：${error.message}`, { type: 'error', duration: 5000 });
    } finally {
        editor.saving = false;
        if (dom.saveBtn) {
            dom.saveBtn.disabled = false;
            dom.saveBtn.textContent = '保存';
        }
    }
}

// --- Markdown toolbar ------------------------------------------------------

function selectedText() {
    if (editor.usesCodeMirror && editor.cm) return editor.cm.getSelection() || '';
    const ta = dom.articleContent;
    return ta.value.slice(ta.selectionStart, ta.selectionEnd) || '';
}

function replaceSelection(text) {
    if (editor.usesCodeMirror && editor.cm) {
        editor.cm.replaceSelection(text, 'end');
        editor.cm.focus();
    } else {
        const ta = dom.articleContent;
        const start = ta.selectionStart;
        const end = Math.max(ta.selectionEnd, start);
        ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
        ta.selectionStart = ta.selectionEnd = start + text.length;
        ta.focus();
        markDirtyState();
    }
    renderPreview();
}

function transformLines(fn) {
    if (editor.usesCodeMirror && editor.cm) {
        const cm = editor.cm;
        const from = cm.getCursor('from').line;
        const to = cm.getCursor('to').line;
        for (let line = from; line <= to; line += 1) {
            const text = cm.getLine(line);
            cm.replaceRange(fn(text), { line, ch: 0 }, { line, ch: text.length });
        }
        cm.focus();
    } else {
        const ta = dom.articleContent;
        const value = ta.value;
        const blockStart = value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
        let blockEnd = value.indexOf('\n', Math.max(ta.selectionEnd, ta.selectionStart));
        if (blockEnd === -1) blockEnd = value.length;
        const next = value.slice(blockStart, blockEnd).split('\n').map(fn).join('\n');
        ta.value = value.slice(0, blockStart) + next + value.slice(blockEnd);
        ta.focus();
        markDirtyState();
    }
    renderPreview();
}

function applyMarkdownAction(action) {
    const selection = selectedText();

    switch (action) {
        case 'h1':
        case 'h2':
        case 'h3': {
            const prefix = `${'#'.repeat(Number(action[1]))} `;
            transformLines((line) => `${prefix}${line.replace(/^#{1,6}\s*/, '')}`);
            break;
        }
        case 'bold':
            replaceSelection(`**${selection || '加粗文本'}**`);
            break;
        case 'italic':
            replaceSelection(`*${selection || '斜体文本'}*`);
            break;
        case 'strike':
            replaceSelection(`~~${selection || '删除文本'}~~`);
            break;
        case 'quote':
            transformLines((line) => `> ${line.replace(/^>\s?/, '')}`);
            break;
        case 'code':
            if (selection.includes('\n')) {
                replaceSelection(`\n\`\`\`\n${selection}\n\`\`\`\n`);
            } else {
                replaceSelection(`\`${selection || '代码'}\``);
            }
            break;
        case 'link':
            insertLink();
            break;
        case 'image':
            insertImage();
            break;
        case 'ul':
            transformLines((line) => `- ${line.replace(/^[-*+]\s*/, '').replace(/^\d+\.\s*/, '')}`);
            break;
        case 'ol':
            transformLines((line) => `1. ${line.replace(/^\d+\.\s*/, '').replace(/^[-*+]\s*/, '')}`);
            break;
        case 'table':
            replaceSelection([
                '',
                '| 列 A | 列 B | 列 C |',
                '| --- | --- | --- |',
                '| 内容 | 内容 | 内容 |',
                '',
            ].join('\n'));
            break;
        case 'hr':
            replaceSelection('\n---\n');
            break;
        default:
            break;
    }
}

async function insertLink() {
    const selection = selectedText();
    const url = await askUrl('插入链接', '链接地址');
    if (!url) return;
    replaceSelection(`[${selection || '链接文字'}](${url})`);
}

async function insertImage() {
    const selection = selectedText();
    const url = await askUrl('插入图片', '图片地址', 'https://... 或 /images/...');
    if (!url) return;
    replaceSelection(`![${selection || '图片说明'}](${url})`);
}

function bindEditorChrome() {
    // #image-preview-error is otherwise never shown: updateImagePreview only hides it.
    dom.imagePreviewImg?.addEventListener('error', () => {
        if (dom.imagePreview?.hidden || !formFields.image.value.trim()) return;
        dom.imagePreviewError.hidden = false;
    });
    dom.imagePreviewImg?.addEventListener('load', () => {
        if (dom.imagePreviewError) dom.imagePreviewError.hidden = true;
    });

    dom.mdToolbar?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        applyMarkdownAction(btn.dataset.action);
    });

    dom.mdPreviewToggle?.addEventListener('click', () => {
        previewVisible = !previewVisible;
        dom.mdEditorBody?.classList.toggle('preview-hidden', !previewVisible);
        dom.mdPreviewToggle.textContent = previewVisible ? '隐藏预览' : '显示预览';
        if (previewVisible) {
            renderPreview();
            editor.cm?.refresh();
        }
    });

    Object.values(formFields).forEach((field) => {
        if (!field) return;
        field.addEventListener('input', markDirtyState);
        field.addEventListener('change', markDirtyState);
    });

    formFields.image?.addEventListener('input', debounce(updateImagePreview, 300));

    dom.articleForm?.addEventListener('submit', (e) => {
        e.preventDefault();
        saveArticle();
    });

    $('close-editor')?.addEventListener('click', attemptCloseEditor);
    $('cancel-edit')?.addEventListener('click', attemptCloseEditor);

    dom.editorModal?.addEventListener('click', (e) => {
        if (e.target === dom.editorModal) attemptCloseEditor();
    });

    document.addEventListener('keydown', (e) => {
        if (activeDialog) return;
        if (!dom.editorModal?.classList.contains('active')) return;

        if (e.key === 'Escape') {
            e.preventDefault();
            attemptCloseEditor();
            return;
        }
        if (!(e.ctrlKey || e.metaKey)) return;
        const key = e.key.toLowerCase();
        if (key === 's') {
            e.preventDefault();
            saveArticle();
        } else if (key === 'b') {
            e.preventDefault();
            applyMarkdownAction('bold');
        } else if (key === 'i') {
            e.preventDefault();
            applyMarkdownAction('italic');
        } else if (key === 'k') {
            e.preventDefault();
            applyMarkdownAction('link');
        }
    });

    window.addEventListener('beforeunload', (e) => {
        if (!dom.editorModal?.classList.contains('active')) return;
        if (!isEditorDirty()) return;
        e.preventDefault();
        e.returnValue = '';
    });
}

// ---------------------------------------------------------------------------
// URL hash state (so a view + filter set can be shared or reloaded)
// ---------------------------------------------------------------------------

const VIEWS = ['articles', 'categories', 'tags', 'backups'];

function writeHash() {
    const params = new URLSearchParams();
    if (state.view === 'articles') {
        if (state.page > 1) params.set('page', state.page);
        Object.entries(state.filters).forEach(([key, value]) => {
            if (value) params.set(key, value);
        });
    }
    if (state.view === 'backups' && state.backupPage > 1) params.set('page', state.backupPage);
    const query = params.toString();
    const next = `#/${state.view}${query ? `?${query}` : ''}`;
    if (location.hash !== next) history.replaceState(null, '', next);
}

function readHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    if (!raw) return false;
    const [view, query = ''] = raw.split('?');
    if (!VIEWS.includes(view)) return false;

    state.view = view;
    const params = new URLSearchParams(query);
    state.page = Math.max(1, Number(params.get('page')) || 1);
    state.filters = {
        search: params.get('search') || '',
        category: params.get('category') || '',
        tag: params.get('tag') || '',
        draft: params.get('draft') || '',
    };
    if (view === 'backups') state.backupPage = Math.max(1, Number(params.get('page')) || 1);
    return true;
}

function syncFilterInputs() {
    if (dom.searchInput) dom.searchInput.value = state.filters.search;
    if (dom.categoryFilter) dom.categoryFilter.value = state.filters.category;
    if (dom.tagFilter) dom.tagFilter.value = state.filters.tag;
    if (dom.draftFilter) dom.draftFilter.value = state.filters.draft;
}

// ---------------------------------------------------------------------------
// Articles list
// ---------------------------------------------------------------------------

function renderSkeletons(count) {
    dom.articleList.innerHTML = Array.from({ length: count }, () => `
        <div class="article-card skeleton-card" aria-hidden="true">
            <div class="article-info">
                <div class="sk sk-title"></div>
                <div class="sk sk-meta"></div>
                <div class="sk sk-tags"></div>
            </div>
        </div>
    `).join('');
}

function renderListError(message) {
    dom.articleList.innerHTML = `
        <div class="state-block error-state">
            <p class="state-title">加载失败</p>
            <p class="state-desc">${escapeHtml(message)}</p>
            <button type="button" class="btn btn-secondary btn-small" data-action="retry">重试</button>
        </div>
    `;
}

function renderEmptyState() {
    const hasFilters = Object.values(state.filters).some(Boolean);
    dom.articleList.innerHTML = `
        <div class="state-block">
            <p class="state-title">${hasFilters ? '没有符合条件的文章' : '还没有文章'}</p>
            <p class="state-desc">${hasFilters ? '试试放宽筛选条件。' : '点击「新建文章」开始写作。'}</p>
            ${hasFilters
                ? '<button type="button" class="btn btn-ghost btn-small" data-action="clear-filters">清除筛选</button>'
                : '<button type="button" class="btn btn-primary btn-small" data-action="new-article">新建文章</button>'}
        </div>
    `;
}

async function loadArticles({ silent = false } = {}) {
    if (!silent) renderSkeletons(Math.min(PAGE_SIZE, 6));

    const params = new URLSearchParams({ page: state.page, limit: PAGE_SIZE });
    Object.entries(state.filters).forEach(([key, value]) => {
        if (value) params.set(key, value);
    });

    try {
        const data = await apiRequest(`/articles?${params}`);
        state.pageArticles = data.data || [];
        state.total = data.total ?? state.pageArticles.length;
        state.totalPages = data.totalPages ?? Math.max(1, Math.ceil(state.total / (data.limit || PAGE_SIZE)));
        state.page = data.page ?? state.page;

        if (state.pageArticles.length === 0) {
            renderEmptyState();
        } else {
            renderArticles(state.pageArticles);
        }
        renderPagination(dom.pagination, state.page, state.totalPages, goToPage);
        renderSummary(data.limit || PAGE_SIZE);
        syncBatchUI();
        writeHash();
    } catch (error) {
        renderListError(error.message);
        if (dom.articlesSummary) dom.articlesSummary.textContent = '';
    }
}

function renderArticles(articles) {
    dom.articleList.innerHTML = articles.map((article) => {
        const selected = state.selected.has(article.path);
        const classes = [
            'article-card',
            article.draft ? 'draft' : 'published',
            state.batchMode ? 'selectable' : '',
            selected ? 'selected' : '',
        ].filter(Boolean).join(' ');

        const status = article.draft
            ? '<span class="status-badge badge-draft">草稿</span>'
            : '<span class="status-badge badge-published">已发布</span>';

        const publishedLabel = article.published ? formatDate(article.published) : '未定日期';
        const publishedTitle = article.published ? formatDateTime(article.published) : '';

        const tags = (article.tags || []).map((tag) => `
            <button type="button" class="tag-badge" data-action="filter-tag" data-tag="${escapeHtml(tag)}" title="按此标签筛选">${escapeHtml(tag)}</button>
        `).join('');

        const batchControl = state.batchMode
            ? `<div class="article-select">
                   <input type="checkbox" data-action="select" ${selected ? 'checked' : ''} aria-label="选择文章">
               </div>`
            : '';

        const actions = state.batchMode
            ? ''
            : `<div class="article-actions">
                   <button type="button" class="btn btn-small btn-secondary" data-action="preview">预览</button>
                   <button type="button" class="btn btn-small" data-action="edit">编辑</button>
                   <button type="button" class="btn btn-small ${article.draft ? 'btn-primary' : 'btn-secondary'}" data-action="toggle-draft" data-draft="${article.draft ? 'true' : 'false'}">${article.draft ? '发布' : '转草稿'}</button>
                   <button type="button" class="btn btn-small btn-danger" data-action="delete">删除</button>
               </div>`;

        return `
            <article class="${classes}" data-path="${escapeHtml(article.path)}">
                ${batchControl}
                <div class="article-info">
                    <div class="article-title-row">
                        <span class="article-title" data-action="edit" title="${escapeHtml(article.path)}">${escapeHtml(article.title || '无标题')}</span>
                        ${status}
                    </div>
                    <div class="article-meta">
                        <span>📁 ${escapeHtml(formatCategoryDisplay(article.category) || '未分类')}</span>
                        <span title="${escapeHtml(publishedTitle)}">📅 ${escapeHtml(publishedLabel)}</span>
                    </div>
                    ${tags ? `<div class="article-tags">${tags}</div>` : ''}
                </div>
                ${actions}
            </article>
        `;
    }).join('');
}

function renderSummary(limit) {
    if (!dom.articlesSummary) return;
    const filtered = Object.values(state.filters).some(Boolean);
    const head = filtered ? `筛选出 ${state.total} 篇 · 共 ${state.total} 篇` : `共 ${state.total} 篇`;
    dom.articlesSummary.textContent = `${head} · 第 ${state.page} / ${state.totalPages} 页 · 每页 ${limit} 篇`;
}

function buildPages(page, totalPages) {
    const pages = [];
    for (let i = Math.max(1, page - 2); i <= Math.min(totalPages, page + 2); i += 1) pages.push(i);
    return pages;
}

function renderPagination(container, page, totalPages, onGo) {
    if (!container) return;
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = [
        `<button type="button" class="page-btn" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>上一页</button>`,
        ...buildPages(page, totalPages).map((i) => `
            <button type="button" class="page-btn ${i === page ? 'active' : ''}" data-page="${i}">${i}</button>
        `),
        `<button type="button" class="page-btn" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>下一页</button>`,
    ].join('');

    container.onclick = (e) => {
        const btn = e.target.closest('[data-page]');
        if (!btn || btn.disabled) return;
        onGo(Number(btn.dataset.page));
    };
}

function goToPage(page) {
    if (page < 1 || page > state.totalPages || page === state.page) return;
    state.page = page;
    clearSelection();
    loadArticles();
}

// ---------------------------------------------------------------------------
// Batch mode
// ---------------------------------------------------------------------------

function syncBatchUI() {
    if (dom.batchToolbar) dom.batchToolbar.hidden = !state.batchMode;
    if (dom.batchModeBtn) {
        dom.batchModeBtn.textContent = state.batchMode ? '退出批量' : '批量管理';
        dom.batchModeBtn.classList.toggle('btn-primary', state.batchMode);
        dom.batchModeBtn.classList.toggle('btn-secondary', !state.batchMode);
    }
    if (dom.batchCount) dom.batchCount.textContent = `已选 ${state.selected.size} 篇`;

    const pageCount = state.pageArticles.length;
    const selectedOnPage = state.pageArticles.filter((a) => state.selected.has(a.path)).length;
    if (dom.batchSelectAll) {
        dom.batchSelectAll.checked = pageCount > 0 && selectedOnPage === pageCount;
        dom.batchSelectAll.indeterminate = selectedOnPage > 0 && selectedOnPage < pageCount;
    }

    const none = state.selected.size === 0;
    ['batch-publish-btn', 'batch-draft-btn', 'batch-tag-add-btn', 'batch-tag-remove-btn',
        'batch-category-btn', 'batch-delete-btn']
        .forEach((id) => {
            const button = $(id);
            if (button) button.disabled = none;
        });
}

function clearSelection() {
    state.selected.clear();
    syncBatchUI();
}

function commonTagOptions() {
    return [{ value: '', label: '（选择标签）' }, ...meta.tags.map((t) => ({ value: t.name, label: `${t.name}（${t.count}）` }))];
}

async function executeBulk(payload, successMessage) {
    if (state.selected.size === 0) {
        showToast('请先选择文章', { type: 'error' });
        return;
    }
    const paths = Array.from(state.selected);

    try {
        const result = await apiRequest('/articles/bulk', {
            method: 'POST',
            body: JSON.stringify({ paths, ...payload }),
        });
        clearSelection();
        await loadArticles({ silent: true });
        refreshMeta({ silent: true });

        const success = result?.success ?? 0;
        const failed = result?.failed ?? 0;
        const skipped = result?.skipped
            ?? Math.max(0, (result?.total ?? paths.length) - success - failed);
        const parts = [`成功 ${success}`];
        if (skipped > 0) parts.push(`无需变更 ${skipped}`);
        if (failed > 0) parts.push(`失败 ${failed}`);

        showToast(`${successMessage}：${parts.join('，')}`, {
            type: failed > 0 ? 'error' : 'success',
            duration: 4000,
            action: failed > 0
                ? { label: '查看失败详情', onClick: () => showFailureDetails(result.failures || []) }
                : null,
        });
    } catch (error) {
        showToast(`批量操作失败：${error.message}`, { type: 'error', duration: 5000 });
    }
}

function showFailureDetails(failures) {
    if (!failures.length) {
        showToast('没有失败记录', { type: 'info' });
        return;
    }
    openDialog({
        title: `失败详情（${failures.length}）`,
        fields: failures.map((f) => ({
            type: 'note',
            key: `f-${f.path}`,
            text: `${f.path} — ${f.reason}`,
        })),
        confirmText: '知道了',
        cancelText: '关闭',
    });
}

function bindBatchActions() {
    dom.batchModeBtn?.addEventListener('click', () => {
        state.batchMode = !state.batchMode;
        if (!state.batchMode) state.selected.clear();
        renderBatchControls();
    });

    $('batch-clear-btn')?.addEventListener('click', () => {
        clearSelection();
        renderBatchControls();
    });

    dom.batchSelectAll?.addEventListener('change', () => {
        const checked = dom.batchSelectAll.checked;
        state.pageArticles.forEach((article) => {
            if (checked) state.selected.add(article.path);
            else state.selected.delete(article.path);
        });
        renderBatchControls();
    });

    $('batch-publish-btn')?.addEventListener('click', () => {
        executeBulk({ operation: 'set_draft', draft: false }, '已设为发布');
    });

    $('batch-draft-btn')?.addEventListener('click', () => {
        executeBulk({ operation: 'set_draft', draft: true }, '已设为草稿');
    });

    $('batch-tag-add-btn')?.addEventListener('click', async () => {
        const tag = await askText('追加标签', '标签名', {
            placeholder: '输入或从已有标签中选择',
            datalistId: 'tag-list-datalist',
        });
        if (tag) await executeBulk({ operation: 'add_tag', tag }, '批量加标签');
    });

    $('batch-tag-remove-btn')?.addEventListener('click', async () => {
        if (!meta.tags.length) {
            showToast('暂无可移除的标签', { type: 'info' });
            return;
        }
        const { ok, values } = await openDialog({
            title: '移除标签',
            fields: [{
                key: 'tag', type: 'select', label: '选择要移除的标签', options: commonTagOptions(),
            }],
        });
        if (ok && values.tag) await executeBulk({ operation: 'remove_tag', tag: values.tag }, '批量移除标签');
    });

    $('batch-category-btn')?.addEventListener('click', async () => {
        const category = await askText('更改分类', '目标分类', {
            placeholder: '例如：Java > JUC',
            datalistId: 'category-list-datalist',
            hint: '多级分类用 > 分隔；文章文件会移动到对应目录',
        });
        if (category) await executeBulk({ operation: 'update_category', category }, '批量改分类');
    });

    $('batch-delete-btn')?.addEventListener('click', async () => {
        const { ok } = await openDialog({
            title: '批量删除',
            message: `确认删除选中的 ${state.selected.size} 篇文章？删除后可在备份视图中恢复。`,
            confirmText: '删除',
            danger: true,
        });
        if (ok) await executeBulk({ operation: 'delete' }, '批量删除');
    });
}

function renderBatchControls() {
    if (state.view !== 'articles' || state.pageArticles.length === 0) {
        syncBatchUI();
        return;
    }
    renderArticles(state.pageArticles);
    syncBatchUI();
}

// ---------------------------------------------------------------------------
// Single-article actions
// ---------------------------------------------------------------------------

async function toggleDraft(path, currentDraft) {
    try {
        await apiRequest(`/articles/${encodeURIComponent(path)}`, {
            method: 'PATCH',
            body: JSON.stringify({ draft: !currentDraft }),
        });
        await loadArticles({ silent: true });
        showToast(!currentDraft ? '已转为草稿' : '已发布');
    } catch (error) {
        showToast(`状态切换失败：${error.message}`, { type: 'error', duration: 4000 });
    }
}

async function deleteArticleWithUndo(path, title) {
    const { ok } = await openDialog({
        title: '删除文章',
        message: `确认删除「${title || path}」？`,
        fields: [{ type: 'note', key: 'path', text: path }],
        confirmText: '删除',
        danger: true,
    });
    if (!ok) return;

    try {
        const result = await apiRequest(`/articles/${encodeURIComponent(path)}`, { method: 'DELETE' });
        await loadArticles({ silent: true });
        refreshMeta({ silent: true });
        showToast('文章已删除', {
            action: result?.backupPath
                ? {
                    label: '撤销',
                    onClick: async () => {
                        try {
                            await apiRequest('/backups/restore', {
                                method: 'POST',
                                body: JSON.stringify({ backupPath: result.backupPath }),
                            });
                            await loadArticles({ silent: true });
                            refreshMeta({ silent: true });
                            showToast('已撤销删除');
                        } catch (error) {
                            showToast(`撤销失败：${error.message}`, { type: 'error', duration: 5000 });
                        }
                    },
                }
                : null,
        });
    } catch (error) {
        showToast(`删除失败：${error.message}`, { type: 'error', duration: 4000 });
    }
}

async function previewArticle(path) {
    try {
        const article = await apiRequest(`/articles/${encodeURIComponent(path)}`);
        const fm = article.frontmatter || {};
        if (dom.previewTitle) dom.previewTitle.textContent = fm.title || '无标题';

        if (dom.previewMeta) {
            const bits = [
                `📁 ${escapeHtml(formatCategoryDisplay(fm.category || '') || '未分类')}`,
                `📅 ${escapeHtml(formatDate(fm.published || fm.date))}`,
                fm.draft ? '📝 草稿' : '✅ 已发布',
            ];
            const tags = (fm.tags || []).map((t) => `<span class="tag-badge">${escapeHtml(t)}</span>`).join('');
            dom.previewMeta.innerHTML = `<span>${bits.join(' · ')}</span>${tags}`;
        }

        if (dom.previewContent) renderMarkdownInto(dom.previewContent, article.content || '');
        dom.previewModal?.classList.add('active');
    } catch (error) {
        showToast(`预览失败：${error.message}`, { type: 'error', duration: 4000 });
    }
}

// ---------------------------------------------------------------------------
// List event delegation (no inline handlers)
// ---------------------------------------------------------------------------

function bindListDelegation() {
    dom.articleList?.addEventListener('click', (e) => {
        const target = e.target;

        const actionEl = target.closest('[data-action]');
        const card = target.closest('.article-card');
        if (!card || !actionEl) {
            if (card && !state.batchMode) {
                openEditorForPath(card.dataset.path);
            }
            return;
        }

        const path = card.dataset.path;
        switch (actionEl.dataset.action) {
            case 'retry':
                loadArticles();
                break;
            case 'clear-filters':
                clearFilters();
                break;
            case 'new-article':
                openEditorForNew();
                break;
            case 'filter-tag':
                e.stopPropagation();
                setFilter('tag', actionEl.dataset.tag || '');
                break;
            case 'select':
                e.stopPropagation();
                toggleSelect(path, actionEl.checked);
                break;
            case 'edit':
                openEditorForPath(path);
                break;
            case 'preview':
                previewArticle(path);
                break;
            case 'toggle-draft':
                toggleDraft(path, actionEl.dataset.draft === 'true');
                break;
            case 'delete':
                deleteArticleWithUndo(path, card.querySelector('.article-title')?.textContent);
                break;
            default:
                break;
        }
    });

    dom.articleList?.addEventListener('change', (e) => {
        const checkbox = e.target.closest('[data-action="select"]');
        if (!checkbox) return;
        const card = checkbox.closest('.article-card');
        if (card) toggleSelect(card.dataset.path, checkbox.checked);
    });
}

function toggleSelect(path, checked) {
    if (checked) state.selected.add(path);
    else state.selected.delete(path);
    const card = dom.articleList?.querySelector(`.article-card[data-path="${CSS.escape(path)}"]`);
    card?.classList.toggle('selected', checked);
    const checkbox = card?.querySelector('[data-action="select"]');
    if (checkbox) checkbox.checked = checked;
    syncBatchUI();
}

function clearFilters() {
    state.filters = { search: '', category: '', tag: '', draft: '' };
    state.page = 1;
    syncFilterInputs();
    loadArticles();
}

function setFilter(key, value) {
    state.filters[key] = value;
    state.page = 1;
    syncFilterInputs();
    loadArticles();
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

async function loadCategories() {
    if (!dom.categoryList) return;
    dom.categoryList.innerHTML = '<div class="state-block"><p class="state-desc">加载中…</p></div>';
    try {
        renderCategories(await apiRequest('/categories'));
    } catch (error) {
        dom.categoryList.innerHTML = `<div class="state-block error-state"><p class="state-title">加载失败</p><p class="state-desc">${escapeHtml(error.message)}</p></div>`;
    }
}

function renderCategories(categories) {
    meta.categories = categories;
    const term = (dom.categorySearch?.value || '').trim().toLowerCase();
    const list = term
        ? categories.filter((c) => `${c.name} ${c.path}`.toLowerCase().includes(term))
        : categories;

    if (!list.length) {
        dom.categoryList.innerHTML = `<div class="state-block"><p class="state-title">${term ? '没有匹配的分类' : '暂无分类'}</p><p class="state-desc">${term ? '换个关键词试试。' : '分类由文章的分类字段自动聚合。'}</p></div>`;
        return;
    }

    dom.categoryList.innerHTML = list.map((cat) => `
        <div class="category-card" data-path="${escapeHtml(cat.path)}" data-name="${escapeHtml(cat.name)}">
            <div class="category-name">${escapeHtml(cat.name)}</div>
            <div class="category-path">${escapeHtml(formatCategoryDisplay(cat.path))}</div>
            <div class="tag-count">${cat.articleCount ?? 0} 篇文章</div>
            <div class="card-actions">
                <button type="button" class="btn btn-small" data-action="view">查看文章</button>
                <button type="button" class="btn btn-small btn-secondary" data-action="rename">重命名</button>
                <button type="button" class="btn btn-small btn-danger" data-action="delete">删除</button>
            </div>
        </div>
    `).join('');
}

async function renameCategory(oldPath) {
    const newName = await askText('重命名分类', '新的分类路径', {
        value: formatCategoryDisplay(oldPath),
        datalistId: 'category-list-datalist',
        hint: '用 > 分隔多级分类，例如 Java > JUC',
    });
    if (!newName) return;

    const normalized = normalizeCategoryPath(newName);
    if (!normalized || normalized === normalizeCategoryPath(oldPath)) return;

    try {
        const result = await apiRequest('/categories/rename', {
            method: 'PATCH',
            body: JSON.stringify({ oldName: oldPath, newName: normalized }),
        });
        showToast(`已重命名分类，移动 ${result?.count ?? 0} 篇文章`);
        await Promise.all([loadCategories(), loadArticles({ silent: true })]);
        refreshMeta({ silent: true });
    } catch (error) {
        showToast(`重命名失败：${error.message}`, { type: 'error', duration: 5000 });
    }
}

async function deleteCategory(catPath, catName) {
    const { ok, values } = await openDialog({
        title: `删除分类「${catName}」`,
        message: '分类是文章所在的目录，请选择分类下文章的处理方式。',
        fields: [
            {
                key: 'mode',
                type: 'radio',
                label: '处理方式',
                options: [
                    { value: 'move', label: '把文章移动到其他分类' },
                    { value: 'delete', label: '连同文章一起删除' },
                ],
                value: 'move',
            },
            {
                key: 'moveTo',
                type: 'select',
                label: '移动到',
                options: [{ value: '', label: '（选择目标分类）' },
                    ...meta.categories
                        .filter((c) => c.path !== catPath)
                        .map((c) => ({ value: c.path, label: formatCategoryDisplay(c.path) }))],
            },
        ],
        confirmText: '继续',
        danger: true,
        validate: (values) => {
            if (values.mode === 'move' && !values.moveTo) {
                return { field: 'moveTo', message: '请选择目标分类' };
            }
            return null;
        },
    });
    if (!ok) return;

    const query = values.mode === 'move'
        ? `?moveTo=${encodeURIComponent(values.moveTo)}`
        : '?deleteArticles=true';

    try {
        const result = await apiRequest(`/categories/${encodeURIComponent(catPath)}${query}`, { method: 'DELETE' });
        showToast(`分类已删除，处理 ${result?.count ?? 0} 篇文章`);
        if (state.filters.category === catPath) setFilter('category', '');
        await Promise.all([loadCategories(), loadArticles({ silent: true })]);
        refreshMeta({ silent: true });
    } catch (error) {
        showToast(`删除分类失败：${error.message}`, { type: 'error', duration: 5000 });
    }
}

function bindCategoryDelegation() {
    dom.categoryList?.addEventListener('click', (e) => {
        const button = e.target.closest('[data-action]');
        const card = e.target.closest('.category-card');
        if (!card) return;
        const path = card.dataset.path;
        if (!button) {
            viewCategoryArticles(path);
            return;
        }
        switch (button.dataset.action) {
            case 'view':
                viewCategoryArticles(path);
                break;
            case 'rename':
                renameCategory(path);
                break;
            case 'delete':
                deleteCategory(path, card.dataset.name);
                break;
            default:
                break;
        }
    });
}

function viewCategoryArticles(categoryPath) {
    setFilter('category', categoryPath);
    switchView('articles');
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

let loadedTags = [];

async function loadTags() {
    if (!dom.tagList) return;
    dom.tagList.innerHTML = '<div class="state-block"><p class="state-desc">加载中…</p></div>';
    try {
        loadedTags = await apiRequest(`/tags?sortBy=${dom.tagSort?.value === 'name' ? 'name' : 'count'}`);
        renderTags(loadedTags);
    } catch (error) {
        dom.tagList.innerHTML = `<div class="state-block error-state"><p class="state-title">加载失败</p><p class="state-desc">${escapeHtml(error.message)}</p></div>`;
    }
}

function renderTags(tags) {
    const term = (dom.tagSearch?.value || '').trim().toLowerCase();
    const list = term ? tags.filter((t) => t.name.toLowerCase().includes(term)) : tags;

    if (!list.length) {
        dom.tagList.innerHTML = `<div class="state-block"><p class="state-title">${term ? '没有匹配的标签' : '暂无标签'}</p><p class="state-desc">${term ? '换个关键词试试。' : '标签由文章的 tags 字段自动聚合。'}</p></div>`;
        return;
    }

    dom.tagList.innerHTML = list.map((tag) => `
        <div class="tag-card" data-name="${escapeHtml(tag.name)}">
            <div class="tag-name">${escapeHtml(tag.name)}</div>
            <div class="tag-count">${tag.count ?? 0} 篇文章</div>
            <div class="card-actions">
                <button type="button" class="btn btn-small" data-action="view">查看文章</button>
                <button type="button" class="btn btn-small btn-secondary" data-action="rename">重命名</button>
                <button type="button" class="btn btn-small btn-danger" data-action="delete">删除</button>
            </div>
        </div>
    `).join('');
}

async function renameTag(oldName) {
    const newName = await askText('重命名标签', '新的标签名', { value: oldName });
    if (!newName || newName === oldName) return;
    try {
        const result = await apiRequest(`/tags/${encodeURIComponent(oldName)}`, {
            method: 'PATCH',
            body: JSON.stringify({ newName }),
        });
        showToast(`已重命名标签，更新 ${result?.count ?? 0} 篇文章`);
        if (state.filters.tag === oldName) setFilter('tag', newName);
        await Promise.all([loadTags(), loadArticles({ silent: true })]);
        refreshMeta({ silent: true });
    } catch (error) {
        showToast(`重命名失败：${error.message}`, { type: 'error', duration: 5000 });
    }
}

async function deleteTag(name) {
    const { ok } = await openDialog({
        title: `删除标签「${name}」`,
        message: '标签会从所有引用它的文章中移除，文章本身不会被删除。',
        confirmText: '删除标签',
        danger: true,
    });
    if (!ok) return;
    try {
        const result = await apiRequest(`/tags/${encodeURIComponent(name)}`, { method: 'DELETE' });
        showToast(`标签已删除，更新 ${result?.count ?? 0} 篇文章`);
        if (state.filters.tag === name) setFilter('tag', '');
        await Promise.all([loadTags(), loadArticles({ silent: true })]);
        refreshMeta({ silent: true });
    } catch (error) {
        showToast(`删除标签失败：${error.message}`, { type: 'error', duration: 5000 });
    }
}

function bindTagDelegation() {
    dom.tagList?.addEventListener('click', (e) => {
        const button = e.target.closest('[data-action]');
        const card = e.target.closest('.tag-card');
        if (!card) return;
        const name = card.dataset.name;
        if (!button) {
            setFilter('tag', name);
            switchView('articles');
            return;
        }
        switch (button.dataset.action) {
            case 'view':
                setFilter('tag', name);
                switchView('articles');
                break;
            case 'rename':
                renameTag(name);
                break;
            case 'delete':
                deleteTag(name);
                break;
            default:
                break;
        }
    });
}

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

async function loadBackups() {
    if (!dom.backupTableWrap) return;
    dom.backupTableWrap.innerHTML = '<div class="state-block"><p class="state-desc">加载中…</p></div>';

    const params = new URLSearchParams({ page: state.backupPage, limit: BACKUP_PAGE_SIZE });
    try {
        const data = await apiRequest(`/backups?${params}`);
        renderBackups(data);
        const totalPages = Math.max(1, Math.ceil((data.total ?? 0) / (data.limit ?? BACKUP_PAGE_SIZE)));
        renderPagination(dom.backupPagination, data.page ?? 1, totalPages, (page) => {
            state.backupPage = page;
            writeHash();
            loadBackups();
        });
        if (dom.backupsSummary) {
            dom.backupsSummary.textContent = `共 ${data.total ?? 0} 个备份 · 第 ${data.page ?? 1} / ${totalPages} 页 · 每页 ${data.limit ?? BACKUP_PAGE_SIZE} 个`;
        }
    } catch (error) {
        dom.backupTableWrap.innerHTML = `<div class="state-block error-state"><p class="state-title">加载失败</p><p class="state-desc">${escapeHtml(error.message)}</p></div>`;
    }
}

function renderBackups(data) {
    const items = data.data || [];
    if (!items.length) {
        dom.backupTableWrap.innerHTML = '<div class="state-block"><p class="state-title">暂无备份</p><p class="state-desc">写入、删除或移动文章后会在这里留下记录。</p></div>';
        return;
    }

    dom.backupTableWrap.innerHTML = `
        <table class="backup-table">
            <thead>
                <tr><th>时间</th><th>源文件</th><th>操作</th><th>大小</th><th></th></tr>
            </thead>
            <tbody>
                ${items.map((item, index) => `
                    <tr data-index="${index}" data-backup="${escapeHtml(item.backupPath)}">
                        <td title="${escapeHtml(formatDateTime(item.createdAt))}">${escapeHtml(relativeTime(item.createdAt))}</td>
                        <td class="backup-source" title="${escapeHtml(item.backupPath)}">${escapeHtml(item.sourcePath)}</td>
                        <td><span class="action-chip action-${escapeHtml(item.action)}">${escapeHtml(item.action)}</span></td>
                        <td>${escapeHtml(formatBytes(item.size))}</td>
                        <td><button type="button" class="btn btn-small btn-secondary" data-action="restore">恢复</button></td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

function bindBackupDelegation() {
    dom.backupTableWrap?.addEventListener('click', (e) => {
        if (!e.target.closest('[data-action="restore"]')) return;
        const row = e.target.closest('tr[data-backup]');
        if (row) restoreBackup(row.dataset.backup);
    });
}

async function restoreBackup(backupPath) {
    const { ok } = await openDialog({
        title: '恢复备份',
        message: '恢复会用所选备份内容覆盖目标文件（当前内容会先自动备份）。',
        fields: [{ type: 'note', key: 'path', text: backupPath }],
        confirmText: '恢复',
        danger: true,
    });
    if (!ok) return;

    try {
        const result = await apiRequest('/backups/restore', {
            method: 'POST',
            body: JSON.stringify({ backupPath }),
        });
        showToast(`已恢复到 ${result?.restoredPath || '目标文件'}`, { duration: 4000 });
        await loadBackups();
        if (state.view === 'articles') loadArticles({ silent: true });
    } catch (error) {
        showToast(`恢复失败：${error.message}`, { type: 'error', duration: 5000 });
    }
}

async function pruneBackups() {
    const { ok } = await openDialog({
        title: '清理过期备份',
        message: '将删除超过保留期限的备份文件，此操作不可撤销。',
        confirmText: '开始清理',
        danger: true,
    });
    if (!ok) return;

    try {
        const result = await apiRequest('/backups/prune', { method: 'POST', body: JSON.stringify({}) });
        showToast(`已清理 ${result?.deleted ?? 0} 个过期备份`);
        await loadBackups();
    } catch (error) {
        showToast(`清理失败：${error.message}`, { type: 'error', duration: 5000 });
    }
}

// ---------------------------------------------------------------------------
// Meta (categories + tags) → datalists and filter selects
// ---------------------------------------------------------------------------

async function refreshMeta({ silent = false } = {}) {
    const [categories, tags] = await Promise.all([
        apiRequest('/categories').catch((e) => { console.error('categories failed', e); return null; }),
        apiRequest('/tags?sortBy=count').catch((e) => { console.error('tags failed', e); return null; }),
    ]);

    if (categories) meta.categories = categories;
    if (tags) meta.tags = tags;

    renderDatalists();
    renderFilterOptions();

    if (!silent && !categories && !tags) {
        showToast('元数据拉取失败', { type: 'error' });
    }
}

function renderDatalists() {
    const categoryDatalist = $('category-list-datalist');
    if (categoryDatalist) {
        categoryDatalist.innerHTML = meta.categories
            .map((c) => `<option value="${escapeHtml(formatCategoryDisplay(c.path))}"></option>`)
            .join('');
    }
    renderCategoryPicker();
    const tagDatalist = $('tag-list-datalist');
    if (tagDatalist) {
        tagDatalist.innerHTML = meta.tags
            .map((t) => `<option value="${escapeHtml(t.name)}"></option>`)
            .join('');
    }
}

function getCategoryPickerOptions() {
    return [...(dom.categoryPickerMenu?.querySelectorAll('[role="option"]') || [])];
}

function renderCategoryPicker() {
    if (!dom.categoryPickerMenu) return;
    const query = formFields.category?.value.trim().toLowerCase() || '';
    const groups = new Map();
    meta.categories
        .map((category) => {
            const path = normalizeCategoryPath(category.path);
            return { path, parts: path.split('/').filter(Boolean) };
        })
        .filter(({ path }) => !query || formatCategoryDisplay(path).toLowerCase().includes(query))
        .forEach((category) => {
            const [parent, ...children] = category.parts;
            if (!groups.has(parent)) groups.set(parent, []);
            groups.get(parent).push({ ...category, children });
        });
    dom.categoryPickerMenu.innerHTML = groups.size ? [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([parent, entries]) => `
        <div class="category-picker-group" role="group" aria-label="${escapeHtml(parent)}">
            <div class="category-picker-heading">${escapeHtml(parent)}</div>
            ${entries.sort((a, b) => a.path.localeCompare(b.path)).map(({ path, children }) => {
                const depth = Math.max(0, children.length - 1);
                const label = children.length
                    ? `<span class="category-picker-parent">${escapeHtml(parent)}</span><span class="category-picker-separator"> &gt; </span><span class="category-picker-child">${escapeHtml(children.join(' > '))}</span>`
                    : escapeHtml(parent);
                return `<button type="button" class="category-picker-option" role="option" data-category="${escapeHtml(formatCategoryDisplay(path))}" data-depth="${depth}">${label}</button>`;
            }).join('')}
        </div>
    `).join('') : '<div class="category-picker-empty">没有匹配的已有分类</div>';
    activeCategoryOption = -1;
}

function setCategoryPickerOpen(open) {
    if (!dom.categoryPickerMenu) return;
    dom.categoryPickerMenu.hidden = !open;
    formFields.category.setAttribute('aria-expanded', String(open));
    if (open) renderCategoryPicker();
}

function bindCategoryPicker() {
    if (!formFields.category) return;
    const picker = formFields.category.parentElement;
    formFields.category.removeAttribute('list');
    const menu = document.createElement('div');
    menu.id = 'category-picker-menu';
    menu.className = 'category-picker-menu';
    menu.setAttribute('role', 'listbox');
    menu.hidden = true;
    picker.classList.add('category-picker');
    picker.appendChild(menu);
    dom.categoryPickerMenu = menu;
    formFields.category.setAttribute('role', 'combobox');
    formFields.category.setAttribute('aria-expanded', 'false');
    formFields.category.setAttribute('aria-controls', menu.id);
    formFields.category.addEventListener('focus', () => setCategoryPickerOpen(true));
    formFields.category.addEventListener('input', () => setCategoryPickerOpen(true));
    formFields.category.addEventListener('keydown', (event) => {
        const options = getCategoryPickerOptions();
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (menu.hidden) setCategoryPickerOpen(true);
            activeCategoryOption = Math.max(0, Math.min(activeCategoryOption + (event.key === 'ArrowDown' ? 1 : -1), options.length - 1));
            options.forEach((option, index) => option.classList.toggle('active', index === activeCategoryOption));
            options[activeCategoryOption]?.scrollIntoView({ block: 'nearest' });
        } else if (event.key === 'Enter' && !menu.hidden && activeCategoryOption >= 0) {
            event.preventDefault();
            formFields.category.value = options[activeCategoryOption].dataset.category;
            setCategoryPickerOpen(false);
        } else if (event.key === 'Escape') {
            setCategoryPickerOpen(false);
        }
    });
    formFields.category.addEventListener('blur', () => window.setTimeout(() => setCategoryPickerOpen(false), 120));
    menu.addEventListener('pointerdown', (event) => {
        const option = event.target.closest('[data-category]');
        if (!option) return;
        event.preventDefault();
        formFields.category.value = option.dataset.category;
        setCategoryPickerOpen(false);
        formFields.category.focus();
    });
}
function renderFilterOptions() {
    if (dom.categoryFilter) {
        const current = state.filters.category;
        dom.categoryFilter.innerHTML = [
            '<option value="">全部分类</option>',
            ...meta.categories.map((c) => `<option value="${escapeHtml(c.path)}">${escapeHtml(formatCategoryDisplay(c.path))}</option>`),
        ].join('');
        dom.categoryFilter.value = current;
    }

    if (dom.tagFilter) {
        const current = state.filters.tag;
        dom.tagFilter.innerHTML = [
            '<option value="">全部标签</option>',
            ...meta.tags.map((t) => `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)}（${t.count ?? 0}）</option>`),
        ].join('');
        dom.tagFilter.value = current;
    }
}

// ---------------------------------------------------------------------------
// Filters / global bindings
// ---------------------------------------------------------------------------

function bindFilters() {
    dom.searchInput?.addEventListener('input', debounce(() => {
        setFilter('search', dom.searchInput.value.trim());
    }, 400));

    dom.categoryFilter?.addEventListener('change', () => setFilter('category', dom.categoryFilter.value));
    dom.tagFilter?.addEventListener('change', () => setFilter('tag', dom.tagFilter.value));
    dom.draftFilter?.addEventListener('change', () => setFilter('draft', dom.draftFilter.value));

    dom.categorySearch?.addEventListener('input', () => renderCategories(meta.categories));
    dom.tagSearch?.addEventListener('input', () => renderTags(loadedTags));
    dom.tagSort?.addEventListener('change', () => loadTags());

    $('new-article-btn')?.addEventListener('click', openEditorForNew);

    $('refresh-btn')?.addEventListener('click', async () => {
        await refreshMeta();
        await loadCurrentView();
        showToast('已刷新', { type: 'info', duration: 1500 });
    });

    $('prune-backups-btn')?.addEventListener('click', pruneBackups);

    $('close-preview')?.addEventListener('click', () => dom.previewModal?.classList.remove('active'));
    dom.previewModal?.addEventListener('click', (e) => {
        if (e.target === dom.previewModal) dom.previewModal.classList.remove('active');
    });

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || activeDialog) return;
        if (dom.previewModal?.classList.contains('active')) dom.previewModal.classList.remove('active');
    });

    window.addEventListener('hashchange', () => {
        if (!readHash()) return;
        syncFilterInputs();
        switchView(state.view, { updateHistory: false });
    });
}

// ---------------------------------------------------------------------------
// View switching
// ---------------------------------------------------------------------------

async function loadCurrentView() {
    if (state.view === 'articles') await loadArticles();
    else if (state.view === 'categories') await loadCategories();
    else if (state.view === 'tags') await loadTags();
    else if (state.view === 'backups') await loadBackups();
}

function switchView(view, { updateHistory = true } = {}) {
    if (!VIEWS.includes(view)) return;
    state.view = view;

    document.querySelectorAll('.nav-item').forEach((item) => {
        item.classList.toggle('active', item.dataset.view === view);
    });
    document.querySelectorAll('.view').forEach((element) => {
        element.classList.toggle('active', element.id === `${view}-view`);
    });

    if (updateHistory) writeHash();
    loadCurrentView();
}

function init() {
    initEditor();
    bindEditorChrome();
    bindCategoryPicker();
    bindFilters();
    bindBatchActions();
    bindListDelegation();
    bindCategoryDelegation();
    bindTagDelegation();
    bindBackupDelegation();

    document.querySelectorAll('.nav-item').forEach((item) => {
        item.addEventListener('click', () => switchView(item.dataset.view));
    });

    if (readHash()) {
        syncFilterInputs();
    } else {
        writeHash();
    }
    switchView(state.view, { updateHistory: false });

    refreshMeta();
}

init();
