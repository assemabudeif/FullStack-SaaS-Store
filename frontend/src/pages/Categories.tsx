import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, FolderOpen, Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import { useAction, useApi, usePermissions } from '../lib/hooks';
import type { Category, List } from '../types';
import { Button, Confirm, Empty, Field, FormFooter, Modal, PageHeader, QueryState } from '../components/ui';

export default function Categories() {
  const query = useApi<List<Category>>('/categories'), permissions = usePermissions(), action = useAction('Category removed.');
  const [edit, setEdit] = useState<Category | 'new' | null>(null), [remove, setRemove] = useState<Category | null>(null);
  return <><PageHeader eyebrow="EVERYTHING IN ITS PLACE" title="Categories" description="A little organization makes a big difference." actions={permissions.admin ? <Button onClick={() => setEdit('new')}><Plus size={17} />Add category</Button> : undefined} />
    <QueryState query={query}>{query.data?.data.length ? <div className="category-grid">{query.data.data.map((category, i) => <article className="panel category-card" key={category.id}><div className={`category-symbol color-${i % 4}`}><FolderOpen size={29} strokeWidth={1.5} /></div><h2>{category.name}</h2><p>A home for the things that belong together.</p><div className="category-card-footer"><Link to={`/products?category=${category.id}`} className="text-link">Explore products <ArrowUpRight size={15} /></Link>{permissions.admin ? <div className="row-actions"><button className="icon-button" aria-label={`Edit ${category.name}`} onClick={() => setEdit(category)}><Pencil size={15} /></button><button className="icon-button" aria-label={`Delete ${category.name}`} onClick={() => setRemove(category)}><Trash2 size={15} /></button></div> : null}</div></article>)}{permissions.admin ? <button className="category-add" onClick={() => setEdit('new')}><span><Plus size={26} /></span><strong>Room for something new.</strong><p>Add a category</p></button> : null}</div> : <Empty title="Give your collection some structure." description="Create a category to organize products." />}</QueryState>
    <div className="page-footnote"><Tag size={14} /> Categories are shared across your store. Referenced categories can’t be deleted.</div>
    {edit ? <CategoryForm category={edit === 'new' ? undefined : edit} onClose={() => setEdit(null)} /> : null}{remove ? <Confirm title={`Delete ${remove.name}?`} description="This is permanent. Move products to a different category first." pending={action.isPending} onClose={() => setRemove(null)} onConfirm={() => action.mutate({ path: `/categories/${remove.id}`, method: 'DELETE' }, { onSuccess: () => setRemove(null) })} /> : null}
  </>;
}
function CategoryForm({ category, onClose }: { category?: Category; onClose: () => void }) {
  const action = useAction('Category saved.');
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); action.mutate({ path: category ? `/categories/${category.id}` : '/categories', method: category ? 'PATCH' : 'POST', body: { name: new FormData(event.currentTarget).get('name') } }, { onSuccess: onClose }); }
  return <Modal title={category ? 'A new name, same collection.' : 'Make room for a new category.'} onClose={onClose}><form className="form-body" onSubmit={submit}><Field label="Category name"><input name="name" required maxLength={100} placeholder="Everyday essentials" defaultValue={category?.name} /></Field><FormFooter pending={action.isPending} onClose={onClose} label="Save category" /></form></Modal>;
}
