// API Configuration
const API_BASE = '/api';

// State
let currentPage = 1;
let totalPages = 1;
let currentFilters = {};
let editingArticlePath = null;
let codeMirrorEditor = null;
let previewVisible = true;

// DOM Elements
const articlesView = document.getElementById('articles-view');
const categoriesView = document.getElementById('categories-view');
const tagsView = document.getElementById('tags-view');
const editorModal = document.getElementById('editor-modal');
const articleForm = document.getElementById('article-form');
const articleList = document.getElementById('article-list');
const categoryList = document.getElementById('category-list');
const tagList = document.getElementById('tag-list');
const pagination = document.getElementById('pagination');
const mdToolbar = document.getElementById('md-toolbar');
const mdPreview = document.getElementById('md-preview');
const mdPreviewToggle = document.getElementById('md-preview-toggle');
const mdEditorBody = document.querySelector('.md-editor-body');
const categoryFilter = document.getElementById('category-filter');
const toastContainer = document.getElementById('toast-container');

function formatCategoryDisplay(category = '') {
    return category
        .replace(/[\\/]+/g, '/')
        .split('/')
        .map(s => s.trim())
        .filter(Boolean)
        .join(' > ');
}

function normalizeCategoryPath(category = '') {
    return category
        .replace(/>/g, '/')
        .replace(/[\\/]+/g, '/')
        .split('/')
        .map(s => s.trim())
        .filter(Boolean)
        .join('/');
}

// Navigation
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => switchView(item.dataset.view));
});

function switchView(view) {
    document.querySelectorAll('.nav-item').forEach(i => {
        i.classList.toggle('active', i.dataset.view === view);
    });

    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`${view}-view`)?.classList.add('active');

    if (view === 'articles') loadArticles();
    if (view === 'categories') loadCategories();
    if (view === 'tags') loadTags();
}

// Initialize CodeMirror
document.addEventListener('DOMContentLoaded', () => {
    const textarea = document.getElementById('article-content');
    codeMirrorEditor = CodeMirror.fromTextArea(textarea, {
        mode: {
            name: 'markdown',
            fencedCodeBlocks: true,
        },
        theme: 'dracula',
        lineNumbers: true,
        lineWrapping: true,
    });
    codeMirrorEditor.on('change', debounce(renderPreview, 150));

    loadArticles();
    loadCategoriesForSelect();
    loadCategoriesForFilter();
    loadTagsForSelect();
    bindMarkdownToolbar();
    renderPreview();
});

function refreshEditorAfterModalOpen() {
    if (!codeMirrorEditor) return;
    requestAnimationFrame(() => {
        codeMirrorEditor.refresh();
        renderPreview();
    });
}

function bindMarkdownToolbar() {
    mdToolbar?.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        applyMarkdownAction(btn.dataset.action);
    });

    mdPreviewToggle?.addEventListener('click', () => {
        previewVisible = !previewVisible;
        mdEditorBody?.classList.toggle('preview-hidden', !previewVisible);
        mdPreviewToggle.textContent = previewVisible ? '隐藏预览' : '显示预览';
        if (previewVisible) renderPreview();
        codeMirrorEditor?.refresh();
    });
}

function applyMarkdownAction(action) {
    if (!codeMirrorEditor) return;
    const doc = codeMirrorEditor.getDoc();
    const selected = doc.getSelection() || '';

    const wrapSelection = (left, right = left, placeholder = '') => {
        const body = selected || placeholder;
        doc.replaceSelection(`${left}${body}${right}`);
    };

    switch (action) {
        case 'h2':
            doc.replaceSelection(`## ${selected || '二级标题'}\n`);
            break;
        case 'h3':
            doc.replaceSelection(`### ${selected || '三级标题'}\n`);
            break;
        case 'bold':
            wrapSelection('**', '**', '加粗文本');
            break;
        case 'italic':
            wrapSelection('*', '*', '斜体文本');
            break;
        case 'quote':
            doc.replaceSelection(`> ${selected || '引用'}\n`);
            break;
        case 'code':
            if (selected.includes('\n')) {
                doc.replaceSelection(`\n\`\`\`\n${selected}\n\`\`\`\n`);
            } else {
                wrapSelection('`', '`', '代码');
            }
            break;
        case 'link':
            doc.replaceSelection(`[${selected || '链接文字'}](https://example.com)`);
            break;
        case 'image':
            doc.replaceSelection(`![${selected || '图片说明'}](https://example.com/image.png)`);
            break;
        case 'ul':
            doc.replaceSelection(`- ${selected || '列表项'}\n`);
            break;
        case 'ol':
            doc.replaceSelection(`1. ${selected || '列表项'}\n`);
            break;
        default:
            break;
    }

    codeMirrorEditor.focus();
    renderPreview();
}

function renderPreview() {
    if (!mdPreview || !codeMirrorEditor || !previewVisible) return;
    const markdown = codeMirrorEditor.getValue();
    if (window.marked?.parse) {
        mdPreview.innerHTML = window.marked.parse(markdown);
        if (window.hljs) {
            mdPreview.querySelectorAll('pre code').forEach((block) => {
                window.hljs.highlightElement(block);
            });
        }
        return;
    }
    mdPreview.innerHTML = `<pre>${escapeHtml(markdown)}</pre>`;
}

function showToast(message, type = 'success', duration = 2200) {
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type === 'error' ? 'error' : ''}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);

    window.setTimeout(() => {
        toast.style.animation = 'toast-out 160ms ease forwards';
        window.setTimeout(() => toast.remove(), 180);
    }, duration);
}

// API Helper Functions
async function apiRequest(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const response = await fetch(url, {
        headers: {
            'Content-Type': 'application/json',
            ...options.headers,
        },
        ...options,
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(error.message || error.error || 'Request failed');
    }

    return response.json();
}

// Articles
async function loadArticles() {
    try {
        const params = new URLSearchParams({
            page: currentPage,
            limit: 20,
            ...currentFilters,
        });

        const data = await apiRequest(`/articles?${params}`);
        renderArticles(data.data);
        renderPagination(data.total, data.page, data.totalPages, data.limit);
    } catch (error) {
        console.error('Failed to load articles:', error);
        articleList.innerHTML = `<div class="error">加载文章失败: ${error.message}</div>`;
    }
}

function renderArticles(articles) {
    if (articles.length === 0) {
        articleList.innerHTML = '<div class="empty">暂无文章</div>';
        return;
    }

    articleList.innerHTML = articles.map(article => `
        <div class="article-card ${article.draft ? 'draft' : 'published'}">
            <div class="article-info">
                <div class="article-title">${escapeHtml(article.title)}</div>
                <div class="article-meta">
                    <span>📁 ${escapeHtml(formatCategoryDisplay(article.category) || '未分类')}</span>
                    <span>📅 ${new Date(article.published).toLocaleDateString('zh-CN')}</span>
                    ${article.draft ? '<span>📝 草稿</span>' : '<span>✅ 已发布</span>'}
                </div>
                ${article.tags.length > 0 ? `
                    <div class="article-tags">
                        ${article.tags.map(tag => `<span class="tag-badge">${escapeHtml(tag)}</span>`).join('')}
                    </div>
                ` : ''}
            </div>
            <div class="article-actions">
                <button class="btn btn-small" onclick="editArticle('${escapeJs(article.path)}')">编辑</button>
                <button class="btn btn-small ${article.draft ? 'btn-primary' : 'btn-secondary'}" onclick="toggleDraft('${escapeJs(article.path)}')">
                    ${article.draft ? '发布' : '转草稿'}
                </button>
                <button class="btn btn-small btn-danger" onclick="deleteArticle('${escapeJs(article.path)}')">删除</button>
            </div>
        </div>
    `).join('');
}

function renderPagination(total, page, totalPages, limit) {
    currentPage = page;
    totalPages = totalPages;

    if (totalPages <= 1) {
        pagination.innerHTML = '';
        return;
    }

    let html = '';

    if (page > 1) {
        html += `<button onclick="goToPage(${page - 1})">上一页</button>`;
    }

    for (let i = Math.max(1, page - 2); i <= Math.min(totalPages, page + 2); i++) {
        html += `<button class="${i === page ? 'active' : ''}" onclick="goToPage(${i})">${i}</button>`;
    }

    if (page < totalPages) {
        html += `<button onclick="goToPage(${page + 1})">下一页</button>`;
    }

    pagination.innerHTML = html;
}

function goToPage(page) {
    currentPage = page;
    loadArticles();
}

// Search and Filter
document.getElementById('search-input')?.addEventListener('input', debounce((e) => {
    currentFilters.search = e.target.value || undefined;
    currentPage = 1;
    loadArticles();
}, 500));

document.getElementById('category-filter')?.addEventListener('change', (e) => {
    currentFilters.category = e.target.value || undefined;
    currentPage = 1;
    loadArticles();
});

document.getElementById('draft-filter')?.addEventListener('change', (e) => {
    currentFilters.draft = e.target.value || undefined;
    currentPage = 1;
    loadArticles();
});

// New Article
document.getElementById('new-article-btn')?.addEventListener('click', () => {
    editingArticlePath = null;
    document.getElementById('editor-title').textContent = '新建文章';
    articleForm.reset();
    if (codeMirrorEditor) codeMirrorEditor.setValue('');
    editorModal.classList.add('active');
    refreshEditorAfterModalOpen();
});

// Edit Article
window.editArticle = async (path) => {
    try {
        const article = await apiRequest(`/articles/${encodeURIComponent(path)}`);
        editingArticlePath = path;
        document.getElementById('editor-title').textContent = '编辑文章';

        document.getElementById('article-title').value = article.frontmatter.title;
        document.getElementById('article-category').value = formatCategoryDisplay(article.frontmatter.category || '');
        document.getElementById('article-tags').value = article.frontmatter.tags.join(', ');
        document.getElementById('article-image').value = article.frontmatter.image || '';
        document.getElementById('article-description').value = article.frontmatter.description || '';
        document.getElementById('article-lang').value = article.frontmatter.lang || '';
        document.getElementById('article-draft').checked = article.frontmatter.draft;

        if (codeMirrorEditor) codeMirrorEditor.setValue(article.content);

        editorModal.classList.add('active');
        refreshEditorAfterModalOpen();
    } catch (error) {
        console.error('Failed to load article:', error);
        showToast(`加载文章失败: ${error.message}`, 'error');
    }
};

// Save Article
articleForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const isEditing = Boolean(editingArticlePath);

    const formData = {
        title: document.getElementById('article-title').value,
        category: formatCategoryDisplay(document.getElementById('article-category').value || ''),
        tags: document.getElementById('article-tags').value
            .split(',')
            .map(t => t.trim())
            .filter(t => t),
        image: document.getElementById('article-image').value || '',
        description: document.getElementById('article-description').value || '',
        lang: document.getElementById('article-lang').value || '',
        draft: document.getElementById('article-draft').checked,
        content: codeMirrorEditor ? codeMirrorEditor.getValue() : '',
    };
    const categoryInput = document.getElementById('article-category').value || '';
    const normalizedCategoryPath = normalizeCategoryPath(categoryInput);

    try {
        if (editingArticlePath) {
            await apiRequest(`/articles/${encodeURIComponent(editingArticlePath)}`, {
                method: 'PATCH',
                body: JSON.stringify({
                    ...formData,
                    newCategory: normalizedCategoryPath,
                }),
            });
        } else {
            await apiRequest('/articles', {
                method: 'POST',
                body: JSON.stringify({
                    ...formData,
                    category: categoryInput,
                }),
            });
        }

        closeEditor();
        loadArticles();
        showToast(isEditing ? '文章已更新' : '文章已创建');
    } catch (error) {
        console.error('Failed to save article:', error);
        showToast(`保存文章失败: ${error.message}`, 'error');
    }
});

// Close Editor
document.getElementById('close-editor')?.addEventListener('click', closeEditor);
document.getElementById('cancel-edit')?.addEventListener('click', closeEditor);

function closeEditor() {
    editorModal.classList.remove('active');
    editingArticlePath = null;
}

// Toggle Draft
window.toggleDraft = async (path) => {
    try {
        const updated = await apiRequest(`/articles/${encodeURIComponent(path)}/toggle-draft`, {
            method: 'PATCH',
        });
        loadArticles();
        showToast(updated?.frontmatter?.draft ? '已切换为草稿' : '已发布');
    } catch (error) {
        console.error('Failed to toggle draft:', error);
        showToast(`切换草稿状态失败: ${error.message}`, 'error');
    }
};

// Delete Article
window.deleteArticle = async (path) => {
    if (!confirm(`确认删除文章「${path}」吗？`)) return;

    try {
        await apiRequest(`/articles/${encodeURIComponent(path)}`, {
            method: 'DELETE',
        });
        loadArticles();
        showToast('文章已删除');
    } catch (error) {
        console.error('Failed to delete article:', error);
        showToast(`删除文章失败: ${error.message}`, 'error');
    }
};

// Categories
async function loadCategories() {
    try {
        const categories = await apiRequest('/categories');
        renderCategories(categories);
    } catch (error) {
        console.error('Failed to load categories:', error);
    }
}

async function loadCategoriesForSelect() {
    try {
        const categories = await apiRequest('/categories');
        const datalist = document.getElementById('category-list-datalist');
        if (datalist) {
            datalist.innerHTML = categories
                .map(c => `<option value="${escapeHtml(formatCategoryDisplay(c.path))}">`)
                .join('');
        }
    } catch (error) {
        console.error('Failed to load categories:', error);
    }
}

async function loadCategoriesForFilter() {
    try {
        const categories = await apiRequest('/categories');
        if (!categoryFilter) return;
        const currentValue = categoryFilter.value;
        categoryFilter.innerHTML = [
            '<option value="">全部分类</option>',
            ...categories.map(c => `<option value="${escapeHtml(c.path)}">${escapeHtml(formatCategoryDisplay(c.path))}</option>`),
        ].join('');
        categoryFilter.value = currentValue || '';
    } catch (error) {
        console.error('Failed to load categories for filter:', error);
    }
}

function renderCategories(categories) {
    if (categories.length === 0) {
        categoryList.innerHTML = '<div class="empty">暂无分类</div>';
        return;
    }

    categoryList.innerHTML = categories.map(cat => `
        <div class="category-card clickable" onclick="viewCategoryArticles('${escapeJs(cat.path)}')">
            <div class="category-name">${escapeHtml(cat.name)}</div>
            <div class="category-path">${escapeHtml(formatCategoryDisplay(cat.path))}</div>
            <div class="tag-count">${cat.articleCount} 篇文章</div>
            <button class="btn btn-small btn-secondary category-view-btn">查看文章</button>
        </div>
    `).join('');
}

window.viewCategoryArticles = (categoryPath) => {
    currentFilters.category = categoryPath;
    currentPage = 1;
    if (categoryFilter) categoryFilter.value = categoryPath;
    switchView('articles');
};

// Tags
async function loadTags() {
    try {
        const tags = await apiRequest('/tags?sortBy=count');
        renderTags(tags);
    } catch (error) {
        console.error('Failed to load tags:', error);
    }
}

async function loadTagsForSelect() {
    try {
        const tags = await apiRequest('/tags');
        const datalist = document.getElementById('tag-list-datalist');
        if (datalist) {
            datalist.innerHTML = tags.map(t => `<option value="${escapeHtml(t.name)}">`).join('');
        }
    } catch (error) {
        console.error('Failed to load tags:', error);
    }
}

function renderTags(tags) {
    if (tags.length === 0) {
        tagList.innerHTML = '<div class="empty">暂无标签</div>';
        return;
    }

    tagList.innerHTML = tags.map(tag => `
        <div class="tag-card">
            <div class="tag-name">${escapeHtml(tag.name)}</div>
            <div class="tag-count">${tag.count} 篇文章</div>
        </div>
    `).join('');
}

// Utility Functions
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function escapeJs(text) {
    return text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}
