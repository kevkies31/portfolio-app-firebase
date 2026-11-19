import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import {
  getFirestore, collection, addDoc, getDocs, doc, updateDoc, deleteDoc,
  query, orderBy, where, getCountFromServer, writeBatch
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import { firebaseConfig, OWNER_EMAIL } from './firebase-config.js';

const DEFAULT_CATEGORIES = ['Web', 'Systems', 'Brand / Logo', 'Automation'];

// ---------- Page elements ----------
const mainEl = document.querySelector('#main');
const formCard = document.querySelector('#form-card');
const form = document.querySelector('#project-form');
const formTitle = document.querySelector('#form-title');
const idInput = document.querySelector('#project-id');
const titleInput = document.querySelector('#title');
const categoryInput = document.querySelector('#category');
const descriptionInput = document.querySelector('#description');
const tagsInput = document.querySelector('#tags');
const linkInput = document.querySelector('#link');
const imageInput = document.querySelector('#image-url');
const yearInput = document.querySelector('#year');
const featuredInput = document.querySelector('#featured');
const cancelBtn = document.querySelector('#cancel-btn');
const searchInput = document.querySelector('#search');
const listEl = document.querySelector('#project-list');
const countEl = document.querySelector('#count');
const categoryCountsEl = document.querySelector('#category-counts');
const tabsEl = document.querySelector('#tabs');
const authBtn = document.querySelector('#auth-btn');
const authStatus = document.querySelector('#auth-status');
const clearAllBtn = document.querySelector('#clear-all-btn');
const exportBtn = document.querySelector('#export-btn');
const importBtn = document.querySelector('#import-btn');
const importInput = document.querySelector('#import-file');
const categoryCard = document.querySelector('#category-card');
const categoryForm = document.querySelector('#category-form');
const categoryNameInput = document.querySelector('#category-name');
const categoryListEl = document.querySelector('#category-list');
const categoryErrorEl = document.querySelector('#category-error');

let activeCategory = 'All';
let all = [];        // every project, newest first
let categories = [];
let owner = false;   // true only for the owner's account

function escapeHTML(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// ---------- Firebase setup ----------
if (firebaseConfig.apiKey.startsWith('PASTE')) {
  listEl.innerHTML = '<p class="empty">Open firebase-config.js and paste your Firebase settings.</p>';
  throw new Error('Firebase config not filled in');
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const projectsRef = collection(db, 'projects');
const categoriesRef = collection(db, 'categories');

// ---------- Login (owner only) ----------
function isOwner(user) {
  return Boolean(
    user && user.emailVerified && user.email &&
    user.email.toLowerCase() === OWNER_EMAIL.toLowerCase()
  );
}

authBtn.addEventListener('click', async () => {
  try {
    if (auth.currentUser) {
      await signOut(auth);
    } else {
      await signInWithPopup(auth, new GoogleAuthProvider());
    }
  } catch (err) {
    alert(err.message);
  }
});

onAuthStateChanged(auth, async (user) => {
  owner = isOwner(user);
  formCard.hidden = !owner;
  categoryCard.hidden = !owner;
  clearAllBtn.hidden = !owner;
  importBtn.hidden = !owner;
  mainEl.classList.toggle('viewer', !owner);
  authBtn.textContent = user ? 'Sign out' : 'Owner sign in';

  if (!user) {
    authStatus.textContent = '';
  } else if (owner) {
    authStatus.textContent = `Signed in as ${user.email}`;
  } else {
    authStatus.textContent = `${user.email} is not the owner (view only)`;
  }

  if (!owner) resetForm();
  renderTabs();
  render();
  await refresh();
});

// ---------- Tabs ----------
function tabLabel(name) {
  return name === 'All' ? 'All work' : name;
}

function renderTabs() {
  const tabs = [{ id: 'All', name: 'All' }, ...getDisplayCategories()];
  tabsEl.innerHTML = tabs.map(({ id, name }) => `
    <button type="button" class="tab ${id === activeCategory ? 'active' : ''}"
            data-tab="${escapeHTML(id)}">${escapeHTML(tabLabel(name))}</button>
  `).join('');
}

tabsEl.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-tab]');
  if (!button) return;
  activeCategory = button.dataset.tab;
  renderTabs();
  render();
});

function getProjectCategory(project) {
  const referenced = categories.find((category) => category.id === project.categoryRef?.id);
  const legacy = categories.find((category) => category.name === project.category);
  if (referenced || legacy) return referenced || legacy;
  return {
    id: `legacy:${project.category || 'uncategorized'}`,
    name: project.category || 'Uncategorized'
  };
}

function getDisplayCategories() {
  const result = [...categories];
  const knownIds = new Set(result.map((category) => category.id));
  all.forEach((project) => {
    const category = getProjectCategory(project);
    if (!knownIds.has(category.id)) {
      knownIds.add(category.id);
      result.push(category);
    }
  });
  return result;
}

function fillCategoryOptions() {
  categoryInput.replaceChildren(new Option('Choose a category...', ''));
  categories.forEach((category) => {
    categoryInput.add(new Option(category.name, category.id));
  });
}

// ---------- Form helpers ----------
function readForm() {
  return {
    title: titleInput.value.trim(),
    categoryRef: doc(categoriesRef, categoryInput.value),
    description: descriptionInput.value.trim(),
    tags: tagsInput.value.split(',').map((t) => t.trim()).filter(Boolean),
    link: linkInput.value.trim(),
    imageUrl: imageInput.value.trim(),
    year: yearInput.value === '' ? null : Number(yearInput.value),
    featured: featuredInput.checked
  };
}

function startEdit(project) {
  idInput.value = project.id;
  titleInput.value = project.title;
  const category = getProjectCategory(project);
  categoryInput.value = categories.some((item) => item.id === category.id) ? category.id : '';
  descriptionInput.value = project.description || '';
  tagsInput.value = (project.tags || []).join(', ');
  linkInput.value = project.link || '';
  imageInput.value = project.imageUrl || '';
  yearInput.value = project.year ?? '';
  featuredInput.checked = project.featured === true;
  formTitle.textContent = 'Edit project';
  cancelBtn.hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetForm() {
  form.reset();
  idInput.value = '';
  formTitle.textContent = 'Add a project';
  cancelBtn.hidden = true;
}

// ---------- Read ----------
async function loadAll() {
  try {
    const snap = await getDocs(query(projectsRef, orderBy('createdAt', 'desc')));
    all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (err) {
    all = [];
    listEl.innerHTML = `<p class="empty">Could not load projects: ${escapeHTML(err.message)}</p>`;
    countEl.textContent = '';
    return false;
  }
  return true;
}

async function loadCategories() {
  try {
    let snap = await getDocs(categoriesRef);
    const existingNames = new Set(
      snap.docs.map((category) => String(category.data().name || '').toLowerCase())
    );
    const missingDefaults = owner
      ? DEFAULT_CATEGORIES.filter((name) => !existingNames.has(name.toLowerCase()))
      : [];

    if (missingDefaults.length > 0) {
      const batch = writeBatch(db);
      missingDefaults.forEach((name) => {
        batch.set(doc(categoriesRef), { name, createdAt: Date.now() });
      });
      await batch.commit();
      snap = await getDocs(categoriesRef);
    }

    categories = snap.docs
      .map((category) => ({
        id: category.id,
        name: category.data().name,
        ref: category.ref
      }))
      .filter((category) => typeof category.name === 'string')
      .sort((a, b) => a.name.localeCompare(b.name));

    categoryErrorEl.textContent = '';
    categoryListEl.innerHTML = categories.map((category) => `
      <li>${escapeHTML(category.name)}</li>
    `).join('');
    fillCategoryOptions();
    renderTabs();
    return true;
  } catch (err) {
    categories = [];
    categoryListEl.textContent = '';
    categoryInput.replaceChildren(new Option('Categories unavailable', ''));
    categoryErrorEl.textContent = `Could not load categories: ${err.message}`;
    renderTabs();
    return false;
  }
}

async function loadCategoryCounts() {
  categoryCountsEl.textContent = 'Loading category counts...';
  try {
    const counts = await Promise.all(getDisplayCategories().map(async (category) => {
      let referencedCount = 0;
      if (category.ref) {
        const result = await getCountFromServer(
          query(projectsRef, where('categoryRef', '==', category.ref))
        );
        referencedCount = result.data().count;
      }
      const legacyCount = all.filter((project) =>
        !project.categoryRef && project.category === category.name
      ).length;
      return { category: category.name, count: referencedCount + legacyCount };
    }));
    categoryCountsEl.innerHTML = counts.map(({ category, count }) => `
      <li><span>${escapeHTML(category)}</span><strong>${count}</strong></li>
    `).join('');
  } catch (err) {
    categoryCountsEl.textContent = `Could not load category counts: ${err.message}`;
  }
}

function render() {
  const text = searchInput.value.trim().toLowerCase();

  let list = activeCategory === 'All'
    ? [...all]
    : all.filter((project) => getProjectCategory(project).id === activeCategory);

  if (text) {
    list = list.filter((p) =>
      (p.title || '').toLowerCase().includes(text) ||
      (p.tags || []).some((t) => t.toLowerCase().includes(text))
    );
  }

  list.sort((a, b) => {
    const aYear = Number.isInteger(a.year) ? a.year : null;
    const bYear = Number.isInteger(b.year) ? b.year : null;
    if (aYear !== bYear) {
      if (aYear === null) return 1;
      if (bYear === null) return -1;
      return bYear - aYear;
    }
    return (b.createdAt || 0) - (a.createdAt || 0);
  });

  countEl.textContent = `${list.length} project(s)`;

  if (list.length === 0) {
    listEl.innerHTML = '<p class="empty">No projects yet.</p>';
    return;
  }

  listEl.innerHTML = list.map((p) => `
    <article class="project">
      ${(p.imageUrl || '').startsWith('https://')
        ? `<img class="thumb" src="${escapeHTML(p.imageUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
        : ''}
      <span class="badge">${escapeHTML(getProjectCategory(p).name)}</span>
      <h3>${escapeHTML(p.title)}${p.featured === true
        ? ' <span class="featured-star" role="img" aria-label="Featured">★</span>'
        : ''}</h3>
      ${Number.isInteger(p.year) ? `<p class="project-year">Year: ${p.year}</p>` : ''}
      <p>${escapeHTML(p.description)}</p>
      <p class="tags">${(p.tags || []).map((t) => `<span>#${escapeHTML(t)}</span>`).join('')}</p>
      ${(p.link || '').startsWith('http')
        ? `<a href="${escapeHTML(p.link)}" target="_blank" rel="noopener">View project</a>`
        : ''}
      ${owner ? `
        <div class="actions">
          <button data-action="edit" data-id="${escapeHTML(p.id)}">Edit</button>
          <button data-action="delete" data-id="${escapeHTML(p.id)}" class="danger">Delete</button>
        </div>` : ''}
    </article>
  `).join('');
}

async function refresh() {
  const categoriesLoaded = await loadCategories();
  const loaded = await loadAll();
  if (categoriesLoaded) await loadCategoryCounts();
  if (loaded) {
    renderTabs();
    render();
  }
}

// ---------- Create / Update / Delete ----------
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!owner) return;

  if (!categoryInput.value) {
    alert('Choose a category before saving the project.');
    return;
  }
  const data = readForm();
  if (data.imageUrl && !data.imageUrl.startsWith('https://')) {
    alert('The thumbnail URL must start with https://');
    return;
  }
  if (data.year !== null && (!Number.isInteger(data.year) || data.year < 1900 || data.year > 2100)) {
    alert('The year must be a whole number between 1900 and 2100.');
    return;
  }

  try {
    const id = idInput.value;
    if (id) {
      await updateDoc(doc(db, 'projects', id), data);
    } else {
      await addDoc(projectsRef, { ...data, createdAt: Date.now() });
    }
  } catch (err) {
    alert(err.message);
    return;
  }

  resetForm();
  await refresh();
});

listEl.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button || !owner) return;

  const id = button.dataset.id;

  if (button.dataset.action === 'edit') {
    startEdit(all.find((p) => p.id === id));
  }

  if (button.dataset.action === 'delete' && confirm('Delete this project?')) {
    try {
      await deleteDoc(doc(db, 'projects', id));
    } catch (err) {
      alert(err.message);
      return;
    }
    await refresh();
  }
});

clearAllBtn.addEventListener('click', async () => {
  if (!owner) return;
  let shouldRefresh = false;
  try {
    const snapshot = await getDocs(projectsRef);
    if (snapshot.empty) {
      alert('There are no projects to delete.');
      return;
    }
    if (!confirm(`Delete all ${snapshot.size} projects? This cannot be undone.`)) return;

    shouldRefresh = true;
    for (let start = 0; start < snapshot.docs.length; start += 500) {
      const batch = writeBatch(db);
      snapshot.docs.slice(start, start + 500).forEach((project) => {
        batch.delete(project.ref);
      });
      await batch.commit();
    }
  } catch (err) {
    alert(`Could not clear all projects. Some may already have been deleted: ${err.message}`);
    shouldRefresh = true;
  }
  if (shouldRefresh) await refresh();
});

categoryForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!owner) return;

  const name = categoryNameInput.value.trim();
  if (!name || name.length > 60) {
    alert('Category names must be between 1 and 60 characters.');
    return;
  }
  if (categories.some((category) => category.name.toLowerCase() === name.toLowerCase())) {
    alert('A category with that name already exists.');
    return;
  }

  try {
    await addDoc(categoriesRef, { name, createdAt: Date.now() });
    categoryForm.reset();
    await refresh();
  } catch (err) {
    alert(`Could not add category: ${err.message}`);
  }
});

function prepareImportedProjects(value) {
  if (!Array.isArray(value)) {
    throw new Error('The JSON file must contain an array of projects.');
  }

  return value.map((project, index) => {
    const fail = (message) => {
      throw new Error(`Project ${index + 1}: ${message}`);
    };
    if (!project || typeof project !== 'object' || Array.isArray(project)) {
      fail('expected a project object.');
    }

    const title = typeof project.title === 'string' ? project.title.trim() : '';
    if (!title || title.length > 120) fail('title must be between 1 and 120 characters.');

    const category = categories.find((item) =>
      typeof project.category === 'string' &&
      item.name.toLowerCase() === project.category.trim().toLowerCase()
    ) || categories.find((item) => item.id === project.categoryId);
    if (!category) fail('category was not found. Add the category before importing.');

    const description = project.description === undefined ? '' : project.description;
    const tags = project.tags === undefined ? [] : project.tags;
    const link = project.link === undefined ? '' : project.link;
    const imageUrl = project.imageUrl === undefined ? '' : project.imageUrl;
    const year = project.year === undefined ? null : project.year;
    const featured = project.featured === undefined ? false : project.featured;

    if (typeof description !== 'string' || description.length > 2000) {
      fail('description must be a string of at most 2,000 characters.');
    }
    if (!Array.isArray(tags) || tags.length > 20 || tags.some((tag) => typeof tag !== 'string')) {
      fail('tags must be an array of at most 20 strings.');
    }
    if (typeof link !== 'string' || link.length > 500) {
      fail('link must be a string of at most 500 characters.');
    }
    if (typeof imageUrl !== 'string' || imageUrl.length > 500 ||
        (imageUrl && !imageUrl.startsWith('https://'))) {
      fail('image URL must be empty or an HTTPS URL of at most 500 characters.');
    }
    if (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2100)) {
      fail('year must be null or a whole number between 1900 and 2100.');
    }
    if (typeof featured !== 'boolean') fail('featured must be true or false.');

    return {
      title,
      categoryRef: category.ref,
      description,
      tags,
      link,
      imageUrl,
      year,
      featured,
      createdAt: Number.isFinite(project.createdAt) ? project.createdAt : Date.now()
    };
  });
}

importBtn.addEventListener('click', () => importInput.click());
importInput.addEventListener('change', async () => {
  const file = importInput.files[0];
  if (!file || !owner) return;

  let imported = 0;
  try {
    const projects = prepareImportedProjects(JSON.parse(await file.text()));
    if (projects.length === 0) {
      alert('The JSON file contains no projects to import.');
      return;
    }
    if (!confirm(`Import ${projects.length} projects?`)) return;

    for (let start = 0; start < projects.length; start += 500) {
      const batch = writeBatch(db);
      const chunk = projects.slice(start, start + 500);
      chunk.forEach((project) => batch.set(doc(projectsRef), project));
      await batch.commit();
      imported += chunk.length;
    }
    await refresh();
    alert(`Imported ${imported} project(s).`);
  } catch (err) {
    const partial = imported ? ` ${imported} project(s) were already imported.` : '';
    alert(`Could not import projects:${partial} ${err.message}`);
  } finally {
    importInput.value = '';
  }
});

exportBtn.addEventListener('click', async () => {
  try {
    const snapshot = await getDocs(projectsRef);
    const projects = snapshot.docs.map((project) => {
      const data = project.data();
      const fields = { ...data };
      delete fields.categoryRef;
      return {
        id: project.id,
        ...fields,
        category: getProjectCategory(data).name
      };
    });
    const blob = new Blob([JSON.stringify(projects, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const download = document.createElement('a');
    download.href = url;
    download.download = 'projects.json';
    document.body.appendChild(download);
    download.click();
    download.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (err) {
    alert(`Could not export projects: ${err.message}`);
  }
});

cancelBtn.addEventListener('click', resetForm);
searchInput.addEventListener('input', render);

// ---------- Start ----------
renderTabs();
