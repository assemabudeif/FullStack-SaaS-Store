import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { storeTransaction, admins, audit, enforceQuota, lockStore, writers } from '../lib/context.js';
import { ApiError, notFound } from '../lib/errors.js';
import { Id, Money, Obj, Pagination, ParamsId, Text, Type } from '../lib/schemas.js';

const productFields = {
  name: Text(), description: Type.Optional(Type.String({ maxLength: 10000 })),
  sku: Type.String({ minLength: 1, maxLength: 80, pattern: '^[A-Za-z0-9._-]+$' }),
  priceCents: Money, categoryId: Type.Optional(Type.Union([Id, Type.Null()])),
  imageUrl: Type.Optional(Type.String({ maxLength: 2000 })),
};

export async function catalogRoutes(instance: FastifyInstance) {
  const app = instance.withTypeProvider<TypeBoxTypeProvider>();
  app.get('/categories', { schema: { tags: ['Categories'] } }, async (r) => ({
    data: await app.db.query('SELECT * FROM categories WHERE tenant_id=$1 ORDER BY name', [r.tenant!.id]),
  }));
  app.post('/categories', {
    preHandler: admins, schema: { tags: ['Categories'], body: Obj({ name: Text(100) }) },
  }, async (r, reply) => {
    const category = await storeTransaction(app, r, async (tx) => {
      const [row] = await tx.query('INSERT INTO categories(id,tenant_id,name) VALUES($1,$2,$3) RETURNING *',
        [randomUUID(), r.tenant!.id, r.body.name]);
      await audit(tx, r, 'category.created', row!.id);
      return row;
    });
    return reply.code(201).send(category);
  });
  app.patch('/categories/:id', {
    preHandler: admins, schema: { tags: ['Categories'], params: ParamsId, body: Obj({ name: Text(100) }) },
  }, async (r) => storeTransaction(app, r, async (tx) => {
    const [row] = await tx.query('UPDATE categories SET name=$3 WHERE tenant_id=$1 AND id=$2 RETURNING *',
      [r.tenant!.id, r.params.id, r.body.name]);
    if (!row) notFound('Category');
    await audit(tx, r, 'category.updated', row.id);
    return row;
  }));
  app.delete('/categories/:id', {
    preHandler: admins, schema: { tags: ['Categories'], params: ParamsId },
  }, async (r, reply) => {
    await storeTransaction(app, r, async (tx) => {
      const [row] = await tx.query('DELETE FROM categories WHERE tenant_id=$1 AND id=$2 RETURNING id', [r.tenant!.id, r.params.id]);
      if (!row) notFound('Category');
      await audit(tx, r, 'category.deleted', row.id);
    });
    return reply.code(204).send();
  });

  app.get('/products', {
    schema: {
      tags: ['Products'],
      querystring: Obj({
        ...Pagination.properties,
        search: Type.Optional(Type.String({ maxLength: 100 })),
        categoryId: Type.Optional(Id),
        active: Type.Optional(Type.Boolean()),
        minPrice: Type.Optional(Type.Integer({ minimum: 0 })),
        maxPrice: Type.Optional(Type.Integer({ minimum: 0 })),
        inStock: Type.Optional(Type.Boolean()),
        // Note: We'll add more filters as we implement more features (rating, etc.)
      })
    }
  }, async (r) => {
    const { page = 1, limit = 20, search, categoryId, active, minPrice, maxPrice, inStock } = r.query;

    // Build WHERE clause dynamically
    const whereConditions = ['tenant_id=$1'];
    const values = [r.tenant!.id];
    let paramIndex = 2;

    // Text search
    if (search) {
      whereConditions.push(`($${paramIndex}::text IS NULL OR name ILIKE $${paramIndex} OR sku ILIKE $${paramIndex})`);
      values.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`);
      paramIndex++;
    }

    // Category filter
    if (categoryId !== undefined && categoryId !== null) {
      whereConditions.push(`($${paramIndex}::uuid IS NULL OR category_id=$${paramIndex})`);
      values.push(categoryId);
      paramIndex++;
    }

    // Active status filter
    if (active !== undefined && active !== null) {
      whereConditions.push(`($${paramIndex}::boolean IS NULL OR active=$${paramIndex})`);
      values.push(active);
      paramIndex++;
    }

    // Price range filter
    if (minPrice !== undefined && minPrice !== null) {
      whereConditions.push(`price_cents >= $${paramIndex}`);
      values.push(minPrice * 100); // Convert to cents
      paramIndex++;
    }

    if (maxPrice !== undefined && maxPrice !== null) {
      whereConditions.push(`price_cents <= $${paramIndex}`);
      values.push(maxPrice * 100); // Convert to cents
      paramIndex++;
    }

    // Stock availability filter
    if (inStock !== undefined && inStock !== null) {
      if (inStock) {
        whereConditions.push(`stock > 0`);
      } else {
        whereConditions.push(`stock <= 0`);
      }
    }

    const whereClause = whereConditions.join(' AND ');

    return storeTransaction(app, r, async (tx) => {
      const [count] = await tx.query(
        `SELECT count(*)::int AS total FROM products WHERE ${whereClause}`,
        values
      );

      const data = await tx.query(
        `SELECT * FROM products WHERE ${whereClause} ORDER BY created_at DESC,id LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...values, limit, (page - 1) * limit]
      );

      return { data, total: count!.total, page, limit };
    });
  });
  app.post('/products', {
    preHandler: writers, schema: { tags: ['Products'], body: Obj({
      ...productFields, initialStock: Type.Optional(Type.Integer({ minimum: 0, maximum: 1000000 })),
    }) },
  }, async (r, reply) => {
    const product = await storeTransaction(app, r, async (tx) => {
      await lockStore(tx, r.tenant!.id);
      await enforceQuota(tx, r.tenant!.id, 'products');
      if (r.body.categoryId) {
        const [category] = await tx.query('SELECT id FROM categories WHERE tenant_id=$1 AND id=$2', [r.tenant!.id, r.body.categoryId]);
        if (!category) notFound('Category');
      }
      const id = randomUUID(), stock = r.body.initialStock ?? 0;
      const [row] = await tx.query(`INSERT INTO products(id,tenant_id,name,description,sku,price_cents,category_id,stock,image_url)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [id, r.tenant!.id, r.body.name, r.body.description ?? '', r.body.sku, r.body.priceCents, r.body.categoryId ?? null, stock, r.body.imageUrl ?? null]);
      if (stock) await tx.query(`INSERT INTO inventory_movements(id,tenant_id,product_id,delta,reason,actor_id)
        VALUES($1,$2,$3,$4,'initial stock',$5)`, [randomUUID(), r.tenant!.id, id, stock, r.identity!.userId]);
      await audit(tx, r, 'product.created', id);
      return row;
    });
    return reply.code(201).send(product);
  });
  app.get('/products/:id', {
    schema: { tags: ['Products'], params: ParamsId },
  }, async (r) => {
    const [product] = await app.db.query('SELECT * FROM products WHERE tenant_id=$1 AND id=$2', [r.tenant!.id, r.params.id]);
    if (!product) notFound('Product');
    return product;
  });
  app.patch('/products/:id', {
    preHandler: writers, schema: { tags: ['Products'], params: ParamsId, body: Type.Partial(Obj({
      ...productFields, active: Type.Boolean(),
    })) },
  }, async (r) => storeTransaction(app, r, async (tx) => {
    await lockStore(tx, r.tenant!.id);
    const [existing] = await tx.query('SELECT * FROM products WHERE tenant_id=$1 AND id=$2 FOR UPDATE', [r.tenant!.id, r.params.id]);
    if (!existing) notFound('Product');
    if (r.body.active && !existing.active) await enforceQuota(tx, r.tenant!.id, 'products');
    if (r.body.categoryId) {
      const [category] = await tx.query('SELECT id FROM categories WHERE tenant_id=$1 AND id=$2', [r.tenant!.id, r.body.categoryId]);
      if (!category) notFound('Category');
    }
    const [row] = await tx.query(`UPDATE products SET name=$3,description=$4,sku=$5,price_cents=$6,
      category_id=$7,active=$8,image_url=COALESCE($9,image_url),updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
    [r.tenant!.id, r.params.id, r.body.name ?? existing.name, r.body.description ?? existing.description,
      r.body.sku ?? existing.sku, r.body.priceCents ?? existing.price_cents,
      r.body.categoryId === undefined ? existing.category_id : r.body.categoryId, r.body.active ?? existing.active,
      r.body.imageUrl === undefined ? null : r.body.imageUrl]);
    await audit(tx, r, 'product.updated', r.params.id, r.body);
    return row;
  }));
  app.delete('/products/:id', {
    preHandler: admins, schema: { tags: ['Products'], summary: 'Archive a product, preserving order history', params: ParamsId },
  }, async (r, reply) => {
    await storeTransaction(app, r, async (tx) => {
      await lockStore(tx, r.tenant!.id);
      const [row] = await tx.query('UPDATE products SET active=false,updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING id',
        [r.tenant!.id, r.params.id]);
      if (!row) notFound('Product');
      await audit(tx, r, 'product.archived', row.id);
    });
    return reply.code(204).send();
  });
  app.post('/products/:id/inventory', {
    preHandler: writers, schema: { tags: ['Inventory'], params: ParamsId, body: Obj({
      delta: Type.Integer({ minimum: -1000000, maximum: 1000000 }),
      reason: Text(500),
    }) },
  }, async (r) => {
    if (r.body.delta === 0) throw new ApiError(400, 'INVALID_ADJUSTMENT', 'Stock adjustment must be nonzero.');
    return storeTransaction(app, r, async (tx) => {
      await lockStore(tx, r.tenant!.id);
      const [row] = await tx.query(`UPDATE products SET stock=stock+$3,updated_at=now()
        WHERE tenant_id=$1 AND id=$2 AND stock+$3 BETWEEN 0 AND 100000000 RETURNING *`,
      [r.tenant!.id, r.params.id, r.body.delta]);
      if (!row) {
        const [exists] = await tx.query('SELECT id FROM products WHERE tenant_id=$1 AND id=$2', [r.tenant!.id, r.params.id]);
        if (!exists) notFound('Product');
        throw new ApiError(409, 'INVALID_STOCK', 'Adjustment would produce invalid stock.');
      }
      await tx.query('INSERT INTO inventory_movements(id,tenant_id,product_id,delta,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6)',
        [randomUUID(), r.tenant!.id, r.params.id, r.body.delta, r.body.reason, r.identity!.userId]);
      await audit(tx, r, 'inventory.adjusted', r.params.id, r.body);
      return row;
    });
  });
  app.get('/inventory/movements', {
    schema: { tags: ['Inventory'], querystring: Obj({ ...Pagination.properties, productId: Type.Optional(Id) }) },
  }, async (r) => {
    const { page = 1, limit = 20 } = r.query;
    return { data: await app.db.query(`SELECT * FROM inventory_movements WHERE tenant_id=$1
      AND ($2::uuid IS NULL OR product_id=$2) ORDER BY created_at DESC,id LIMIT $3 OFFSET $4`,
    [r.tenant!.id, r.query.productId ?? null, limit, (page - 1) * limit]), page, limit };
  });

  // Product Options Management
  app.get('/products/:productId/options', {
    schema: {
      tags: ['Product Options'],
      params: ParamsId,
      querystring: Pagination
    }
  }, async (r) => {
    const { page = 1, limit = 20 } = r.query;
    const [count] = await app.db.query(
      'SELECT count(*)::int AS total FROM product_options WHERE tenant_id=$1',
      [r.tenant!.id]
    );
    const data = await app.db.query(
      'SELECT * FROM product_options WHERE tenant_id=$1 ORDER BY position, name LIMIT $2 OFFSET $3',
      [r.tenant!.id, limit, (page - 1) * limit]
    );
    return { data, total: count!.total, page, limit };
  });

  app.post('/products/:productId/options', {
    preHandler: writers,
    schema: {
      tags: ['Product Options'],
      params: ParamsId,
      body: Obj({ name: Text(100) })
    }
  }, async (r, reply) => {
    const option = await storeTransaction(app, r, async (tx) => {
      const [row] = await tx.query(
        'INSERT INTO product_options(id,tenant_id,name) VALUES($1,$2,$3) RETURNING *',
        [randomUUID(), r.tenant!.id, r.body.name]
      );
      await audit(tx, r, 'product_option.created', row.id);
      return row;
    });
    return reply.code(201).send(option);
  });

  app.patch('/products/:productId/options/:optionId', {
    preHandler: writers,
    schema: {
      tags: ['Product Options'],
      params: Type.Object({ id: Id, optionId: Id }),
      body: Obj({ name: Type.Optional(Text(100)), position: Type.Optional(Type.Integer({ minimum: 0 })) })
    }
  }, async (r) => {
    const updates = [];
    const values = [r.tenant!.id, r.params.optionId];

    if (r.body.name !== undefined) {
      updates.push('name=$' + (updates.length + 3));
      values.push(r.body.name);
    }

    if (r.body.position !== undefined) {
      updates.push('position=$' + (updates.length + 3));
      values.push(r.body.position);
    }

    if (updates.length === 0) {
      return await app.db.query(
        'SELECT * FROM product_options WHERE tenant_id=$1 AND id=$2',
        [r.tenant!.id, r.params.optionId]
      );
    }

    const [row] = await app.db.query(
      `UPDATE product_options SET ${updates.join(', ')},updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *`,
      [...values, r.tenant!.id, r.params.optionId]
    );

    if (!row) {
      throw new ApiError(404, 'OPTION_NOT_FOUND', 'Option not found');
    }

    await audit(app.db as any, r, 'product_option.updated', r.params.optionId, r.body);
    return row;
  });

  app.delete('/products/:productId/options/:optionId', {
    preHandler: writers,
    schema: {
      tags: ['Product Options'],
      params: Type.Object({ id: Id, optionId: Id })
    }
  }, async (r, reply) => {
    await storeTransaction(app, r, async (tx) => {
      const [row] = await tx.query(
        'DELETE FROM product_options WHERE tenant_id=$1 AND id=$2 RETURNING id',
        [r.tenant!.id, r.params.optionId]
      );
      if (!row) {
        throw new ApiError(404, 'OPTION_NOT_FOUND', 'Option not found');
      }
      await audit(tx, r, 'product_option.deleted', r.params.optionId);
    });
    return reply.code(204).send();
  });

  // Product Option Values Management
  app.get('/products/:productId/options/:optionId/values', {
    schema: {
      tags: ['Product Option Values'],
      params: Type.Object({ id: Id, optionId: Id }),
      querystring: Pagination
    }
  }, async (r) => {
    const { page = 1, limit = 20 } = r.query;
    const [count] = await app.db.query(
      'SELECT count(*)::int AS total FROM product_option_values WHERE tenant_id=$1 AND option_id=$2',
      [r.tenant!.id, r.params.optionId]
    );
    const data = await app.db.query(
      'SELECT * FROM product_option_values WHERE tenant_id=$1 AND option_id=$2 ORDER BY position, value LIMIT $3 OFFSET $4',
      [r.tenant!.id, r.params.optionId, limit, (page - 1) * limit]
    );
    return { data, total: count!.total, page, limit };
  });

  app.post('/products/:productId/options/:optionId/values', {
    preHandler: writers,
    schema: {
      tags: ['Product Option Values'],
      params: Type.Object({ id: Id, optionId: Id }),
      body: Obj({ value: Text(100) })
    }
  }, async (r, reply) => {
    const optionValue = await storeTransaction(app, r, async (tx) => {
      const [row] = await tx.query(
        'INSERT INTO product_option_values(id,tenant_id,option_id,value) VALUES($1,$2,$3,$4) RETURNING *',
        [randomUUID(), r.tenant!.id, r.params.optionId, r.body.value]
      );
      await audit(tx, r, 'product_option_value.created', row.id);
      return row;
    });
    return reply.code(201).send(optionValue);
  });

  app.patch('/products/:productId/options/:optionId/values/:valueId', {
    preHandler: writers,
    schema: {
      tags: ['Product Option Values'],
      params: Type.Object({ id: Id, optionId: Id, valueId: Id }),
      body: Obj({ value: Type.Optional(Text(100)), position: Type.Optional(Type.Integer({ minimum: 0 })) })
    }
  }, async (r) => {
    const updates = [];
    const values = [r.tenant!.id, r.params.optionId, r.params.valueId];

    if (r.body.value !== undefined) {
      updates.push('value=$' + (updates.length + 4));
      values.push(r.body.value);
    }

    if (r.body.position !== undefined) {
      updates.push('position=$' + (updates.length + 4));
      values.push(r.body.position);
    }

    if (updates.length === 0) {
      return await app.db.query(
        'SELECT * FROM product_option_values WHERE tenant_id=$1 AND option_id=$2 AND id=$3',
        [r.tenant!.id, r.params.optionId, r.params.valueId]
      );
    }

    const [row] = await app.db.query(
      `UPDATE product_option_values SET ${updates.join(', ')},updated_at=now() WHERE tenant_id=$1 AND option_id=$2 AND id=$3 RETURNING *`,
      [...values, r.tenant!.id, r.params.optionId, r.params.valueId]
    );

    if (!row) {
      throw new ApiError(404, 'OPTION_VALUE_NOT_FOUND', 'Option value not found');
    }

    await audit(app.db as any, r, 'product_option_value.updated', r.params.valueId, r.body);
    return row;
  });

  app.delete('/products/:productId/options/:optionId/values/:valueId', {
    preHandler: writers,
    schema: {
      tags: ['Product Option Values'],
      params: Type.Object({ id: Id, optionId: Id, valueId: Id })
    }
  }, async (r, reply) => {
    await storeTransaction(app, r, async (tx) => {
      const [row] = await tx.query(
        'DELETE FROM product_option_values WHERE tenant_id=$1 AND option_id=$2 AND id=$3 RETURNING id',
        [r.tenant!.id, r.params.optionId, r.params.valueId]
      );
      if (!row) {
        throw new ApiError(404, 'OPTION_VALUE_NOT_FOUND', 'Option value not found');
      }
      await audit(tx, r, 'product_option_value.deleted', r.params.valueId);
    });
    return reply.code(204).send();
  });

  // Product Variants Management
  app.get('/products/:productId/variants', {
    schema: {
      tags: ['Product Variants'],
      params: ParamsId,
      querystring: Pagination
    }
  }, async (r) => {
    const { page = 1, limit = 20 } = r.query;
    const [count] = await app.db.query(
      'SELECT count(*)::int AS total FROM product_variants WHERE tenant_id=$1 AND product_id=$2',
      [r.tenant!.id, r.params.productId]
    );
    const data = await app.db.query(
      `SELECT pv.*,
        jsonb_agg(
          jsonb_build_object(
            'option_id', pvo.option_id,
            'option_value_id', pvo.option_value_id,
            'option_name', po.name,
            'option_value', pov.value
          ) ORDER BY po.position
        ) as options
      FROM product_variants pv
      LEFT JOIN product_variant_options pvo ON pv.id = pvo.variant_id AND pv.tenant_id = pvo.tenant_id
      LEFT JOIN product_options po ON pvo.option_id = po.id AND pv.tenant_id = po.tenant_id
      LEFT JOIN product_option_values pov ON pvo.option_value_id = pov.id AND pv.tenant_id = pov.tenant_id
      WHERE pv.tenant_id=$1 AND pv.product_id=$2
      GROUP BY pv.id
      ORDER BY pv.created_at DESC
      LIMIT $3 OFFSET $4`,
      [r.tenant!.id, r.params.productId, limit, (page - 1) * limit]
    );
    return { data, total: count!.total, page, limit };
  });

  app.post('/products/:productId/variants', {
    preHandler: writers,
    schema: {
      tags: ['Product Variants'],
      params: ParamsId,
      body: Obj({
        sku: Type.String({ minLength: 1, maxLength: 80, pattern: '^[A-Za-z0-9._-]+$' }),
        priceAdjustment: Type.Integer({ minimum: -100000000, maximum: 100000000 }),
        stockAdjustment: Type.Integer({ minimum: -1000000, maximum: 1000000 }),
        isActive: Type.Optional(Type.Boolean()),
        options: Type.Array(
          Type.Object({
            optionId: Id,
            optionValueId: Id
          })
        )
      })
    }
  }, async (r, reply) => {
    // Validate that all selected options belong to the product
    const variant = await storeTransaction(app, r, async (tx) => {
      // Check if product exists and belongs to tenant
      const [product] = await tx.query(
        'SELECT id FROM products WHERE tenant_id=$1 AND id=$2',
        [r.tenant!.id, r.params.productId]
      );
      if (!product) {
        throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
      }

      // Check if SKU already exists for this tenant
      const [existingSku] = await tx.query(
        'SELECT id FROM product_variants WHERE tenant_id=$1 AND sku=$2',
        [r.tenant!.id, r.body.sku]
      );
      if (existingSku) {
        throw new ApiError(409, 'SKU_EXISTS', 'SKU already exists');
      }

      // Validate that all options belong to the product
      if (r.body.options && r.body.options.length > 0) {
        const optionIds = r.body.options.map(opt => opt.optionId);
        const optionValueIds = r.body.options.map(opt => opt.optionValueId);

        // Check options belong to tenant
        const [optionCheck] = await tx.query(
          'SELECT COUNT(*) as count FROM product_options WHERE tenant_id=$1 AND id = ANY($2)',
          [r.tenant!.id, optionIds]
        );

        // Check option values belong to tenant and their respective options
        const [optionValueCheck] = await tx.query(
          'SELECT COUNT(*) as count FROM product_option_values pov ' +
          'JOIN product_options po ON pov.option_id = po.id ' +
          'WHERE pov.tenant_id=$1 AND pov.id = ANY($2) AND po.id = ANY($3)',
          [r.tenant!.id, optionValueIds, optionIds]
        );

        if (optionCheck?.count !== optionIds.length || optionValueCheck?.count !== optionValueIds.length) {
          throw new ApiError(400, 'INVALID_OPTIONS', 'Selected options or option values do not belong to this product or tenant');
        }

        // Check for duplicate option selections
        const uniqueOptions = new Set(optionIds);
        if (uniqueOptions.size !== optionIds.length) {
          throw new ApiError(400, 'DUPLICATE_OPTIONS', 'Duplicate options selected');
        }
      }

      const id = randomUUID();
      const priceAdjustment = r.body.priceAdjustment ?? 0;
      const stockAdjustment = r.body.stockAdjustment ?? 0;
      const isActive = r.body.isActive ?? true;

      const [variantRow] = await tx.query(
        `INSERT INTO product_variants(id,tenant_id,product_id,sku,price_cents_integer_adjustment,stock_adjustment,is_active)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [id, r.tenant!.id, r.params.productId, r.body.sku, priceAdjustment, stockAdjustment, isActive]
      );

      // Add variant options
      if (r.body.options && r.body.options.length > 0) {
        for (const option of r.body.options) {
          await tx.query(
            'INSERT INTO product_variant_options(id,tenant_id,variant_id,option_id,option_value_id) VALUES($1,$2,$3,$4,$5)',
            [randomUUID(), r.tenant!.id, id, option.optionId, option.optionValueId]
          );
        }
      }

      await audit(tx, r, 'product_variant.created', id);
      return variantRow;
    });

    return reply.code(201).send(variant);
  });

  app.patch('/products/:productId/variants/:variantId', {
    preHandler: writers,
    schema: {
      tags: ['Product Variants'],
      params: Type.Object({ id: Id, variantId: Id }),
      body: Obj({
        sku: Type.Optional(Type.String({ minLength: 1, maxLength: 80, pattern: '^[A-Za-z0-9._-]+$' })),
        priceAdjustment: Type.Optional(Type.Integer({ minimum: -100000000, maximum: 100000000 })),
        stockAdjustment: Type.Optional(Type.Integer({ minimum: -1000000, maximum: 1000000 })),
        isActive: Type.Optional(Type.Boolean()),
        options: Type.Optional(Type.Array(
          Type.Object({
            optionId: Id,
            optionValueId: Id
          })
        ))
      })
    }
  }, async (r) => {
    const variant = await storeTransaction(app, r, async (tx) => {
      // Check if variant exists and belongs to tenant and product
      const [existingVariant] = await tx.query(
        'SELECT * FROM product_variants WHERE tenant_id=$1 AND id=$2 AND product_id=$3',
        [r.tenant!.id, r.params.variantId, r.params.productId]
      );
      if (!existingVariant) {
        throw new ApiError(404, 'VARIANT_NOT_FOUND', 'Variant not found');
      }

      // Check SKU uniqueness if being updated
      if (r.body.sku && r.body.sku !== existingVariant.sku) {
        const [existingSku] = await tx.query(
          'SELECT id FROM product_variants WHERE tenant_id=$1 AND sku=$2 AND id<>($3)',
          [r.tenant!.id, r.body.sku, r.params.variantId]
        );
        if (existingSku) {
          throw new ApiError(409, 'SKU_EXISTS', 'SKU already exists');
        }
      }

      // Build update query
      const updates = [];
      const values = [r.tenant!.id, r.params.variantId];

      if (r.body.sku !== undefined) {
        updates.push('sku=$' + (updates.length + 3));
        values.push(r.body.sku);
      }

      if (r.body.priceAdjustment !== undefined) {
        updates.push('price_cents_integer_adjustment=$' + (updates.length + 3));
        values.push(r.body.priceAdjustment);
      }

      if (r.body.stockAdjustment !== undefined) {
        updates.push('stock_adjustment=$' + (updates.length + 3));
        values.push(r.body.stockAdjustment);
      }

      if (r.body.isActive !== undefined) {
        updates.push('is_active=$' + (updates.length + 3));
        values.push(r.body.isActive);
      }

      if (updates.length > 0) {
        updates.push('updated_at=now()');
        const [variantRow] = await tx.query(
          `UPDATE product_variants SET ${updates.join(', ')} WHERE tenant_id=$1 AND id=$2 RETURNING *`,
          [...values, r.tenant!.id, r.params.variantId]
        );

        // Handle options update if provided
        if (r.body.options !== undefined) {
          // Delete existing options
          await tx.query(
            'DELETE FROM product_variant_options WHERE tenant_id=$1 AND variant_id=$2',
            [r.tenant!.id, r.params.variantId]
          );

          // Add new options if any
          if (r.body.options && r.body.options.length > 0) {
            // Validate options belong to product and tenant
            const optionIds = r.body.options.map(opt => opt.optionId);
            const optionValueIds = r.body.options.map(opt => opt.optionValueId);

            const [optionCheck] = await tx.query(
              'SELECT COUNT(*) as count FROM product_options WHERE tenant_id=$1 AND id = ANY($2)',
              [r.tenant!.id, optionIds]
            );

            const [optionValueCheck] = await tx.query(
              'SELECT COUNT(*) as count FROM product_option_values pov ' +
              'JOIN product_options po ON pov.option_id = po.id ' +
              'WHERE pov.tenant_id=$1 AND pov.id = ANY($2) AND po.id = ANY($3)',
              [r.tenant!.id, optionValueIds, optionIds]
            );

            if (optionCheck?.count !== optionIds.length || optionValueCheck?.count !== optionValueIds.length) {
              throw new ApiError(400, 'INVALID_OPTIONS', 'Selected options or option values do not belong to this product or tenant');
            }

            // Check for duplicate option selections
            const uniqueOptions = new Set(optionIds);
            if (uniqueOptions.size !== optionIds.length) {
              throw new ApiError(400, 'DUPLICATE_OPTIONS', 'Duplicate options selected');
            }

            // Add new variant options
            for (const option of r.body.options) {
              await tx.query(
                'INSERT INTO product_variant_options(id,tenant_id,variant_id,option_id,option_value_id) VALUES($1,$2,$3,$4,$5)',
                [randomUUID(), r.tenant!.id, r.params.variantId, option.optionId, option.optionValueId]
              );
            }
          }
        }

        await audit(tx, r, 'product_variant.updated', r.params.variantId, r.body);
        return variantRow;
      } else {
        // No field updates, just return existing variant
        await audit(app.db as any, r, 'product_variant.viewed', r.params.variantId);
        return existingVariant;
      }
    });

    return variant;
  });

  app.delete('/products/:productId/variants/:variantId', {
    preHandler: writers,
    schema: {
      tags: ['Product Variants'],
      params: Type.Object({ id: Id, variantId: Id })
    }
  }, async (r, reply) => {
    await storeTransaction(app, r, async (tx) => {
      // Check if variant exists and belongs to tenant and product
      const [existingVariant] = await tx.query(
        'SELECT id FROM product_variants WHERE tenant_id=$1 AND id=$2 AND product_id=$3',
        [r.tenant!.id, r.params.variantId, r.params.productId]
      );
      if (!existingVariant) {
        throw new ApiError(404, 'VARIANT_NOT_FOUND', 'Variant not found');
      }

      // Delete variant options first (due to foreign key constraints)
      await tx.query(
        'DELETE FROM product_variant_options WHERE tenant_id=$1 AND variant_id=$2',
        [r.tenant!.id, r.params.variantId]
      );

      // Delete the variant
      const [row] = await tx.query(
        'DELETE FROM product_variants WHERE tenant_id=$1 AND id=$2 RETURNING id',
        [r.tenant!.id, r.params.variantId]
      );

      if (!row) {
        throw new ApiError(404, 'VARIANT_NOT_FOUND', 'Variant not found');
      }

      await audit(tx, r, 'product_variant.deleted', r.params.variantId);
    });
    return reply.code(204).send();
  });

  // Get product with its options and values (for frontend product detail page)
  app.get('/products/:productId/with-options', {
    schema: {
      tags: ['Products'],
      params: ParamsId
    }
  }, async (r) => {
    const [product] = await app.db.query(
      'SELECT * FROM products WHERE tenant_id=$1 AND id=$2',
      [r.tenant!.id, r.params.productId]
    );
    if (!product) {
      throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
    }

    // Get options and their values for this product
    const optionsWithValues = await app.db.query(
      `SELECT po.*,
        jsonb_agg(
          jsonb_build_object(
            'id', pov.id,
            'value', pov.value,
            'position', pov.position
          ) ORDER BY pov.position
        ) as values
      FROM product_options po
      LEFT JOIN product_option_values pov ON po.id = pov.option_id AND po.tenant_id = pov.tenant_id
      WHERE po.tenant_id=$1
      GROUP BY po.id
      ORDER BY po.position, po.name`,
      [r.tenant!.id]
    );

    // Get active variants for this product
    const variants = await app.db.query(
      `SELECT pv.*,
        jsonb_agg(
          jsonb_build_object(
            'option_id', pvo.option_id,
            'option_value_id', pvo.option_value_id,
            'option_name', po.name,
            'option_value', pov.value
          ) ORDER BY po.position
        ) as options
      FROM product_variants pv
      LEFT JOIN product_variant_options pvo ON pv.id = pvo.variant_id AND pv.tenant_id = pvo.tenant_id
      LEFT JOIN product_options po ON pvo.option_id = po.id AND pv.tenant_id = po.tenant_id
      LEFT JOIN product_option_values pov ON pvo.option_value_id = pov.id AND pv.tenant_id = pov.tenant_id
      WHERE pv.tenant_id=$1 AND pv.product_id=$2 AND pv.is_active=true
      GROUP BY pv.id
      ORDER BY pv.created_at`,
      [r.tenant!.id, r.params.productId]
    );

    return {
      ...product,
      options: optionsWithValues,
      variants
    };
  });

  // Product Reviews Management
  app.get('/products/:productId/reviews', {
    schema: {
      tags: ['Product Reviews'],
      params: ParamsId,
      querystring: Obj({
        ...Pagination.properties,
        rating: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })),
        sort: Type.Optional(Type.Union([
          Type.Literal('newest'),
          Type.Literal('oldest'),
          Type.Literal('helpful'),
          Type.Literal('rating-high'),
          Type.Literal('rating-low')
        ]))
      })
    }
  }, async (r) => {
    const { page = 1, limit = 20, rating, sort = 'newest' } = r.query;

    // Build WHERE clause dynamically
    const whereConditions = ['tenant_id=$1', 'product_id=$2'];
    const values = [r.tenant!.id, r.params.productId];
    let paramIndex = 3;

    // Rating filter
    if (rating !== undefined && rating !== null) {
      whereConditions.push(`rating=$${paramIndex}`);
      values.push(rating);
      paramIndex++;
    }

    // Build ORDER BY clause based on sort parameter
    let orderByClause = 'created_at DESC'; // Default: newest first
    if (sort === 'oldest') {
      orderByClause = 'created_at ASC';
    } else if (sort === 'helpful') {
      orderByClause = 'helpful_votes DESC, total_votes DESC';
    } else if (sort === 'rating-high') {
      orderByClause = 'rating DESC, created_at DESC';
    } else if (sort === 'rating-low') {
      orderByClause = 'rating ASC, created_at DESC';
    }

    return storeTransaction(app, r, async (tx) => {
      const [count] = await tx.query(
        `SELECT count(*)::int AS total FROM product_reviews WHERE ${whereConditions.join(' AND ')}`,
        values
      );

      const data = await tx.query(
        `SELECT * FROM product_reviews WHERE ${whereConditions.join(' AND ')} ORDER BY ${orderByClause} LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...values, limit, (page - 1) * limit]
      );

      return { data, total: count!.total, page, limit };
    });
  });

  app.post('/products/:productId/reviews', {
    preHandler: writers,
    schema: {
      tags: ['Product Reviews'],
      params: ParamsId,
      body: Obj({
        rating: Type.Integer({ minimum: 1, maximum: 5 }),
        title: Type.String({ minLength: 1, maxLength: 200 }),
        comment: Type.Optional(Type.String({ maxLength: 5000 }))
      })
    }
  }, async (r, reply) => {
    // Verify product exists and belongs to tenant
    const [product] = await app.db.query(
      'SELECT id FROM products WHERE tenant_id=$1 AND id=$2 AND active=true',
      [r.tenant!.id, r.params.productId]
    );
    if (!product) {
      throw new ApiError(404, 'PRODUCT_NOT_FOUND', 'Product not found or inactive');
    }

    // Check if customer has purchased this product (verified purchase)
    let isVerifiedPurchase = false;
    const [purchaseCheck] = await app.db.query(
      `SELECT COUNT(*) as count FROM orders o
       JOIN order_items oi ON o.id = oi.order_id
       WHERE o.tenant_id=$1 AND o.customer_id=$2 AND o.status='completed'
         AND oi.product_id=$3`,
      [r.tenant!.id, r.identity!.userId, r.params.productId]
    );
    if (purchaseCheck?.count > 0) {
      isVerifiedPurchase = true;
    }

    // Check if customer already reviewed this product
    const [existingReview] = await app.db.query(
      'SELECT id FROM product_reviews WHERE tenant_id=$1 AND product_id=$2 AND customer_id=$3',
      [r.tenant!.id, r.params.productId, r.identity!.userId]
    );
    if (existingReview) {
      throw new ApiError(409, 'REVIEW_EXISTS', 'You have already reviewed this product');
    }

    const review = await storeTransaction(app, r, async (tx) => {
      const [row] = await tx.query(
        'INSERT INTO product_reviews(id,tenant_id,product_id,customer_id,rating,title,comment,is_verified_purchase) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
        [randomUUID(), r.tenant!.id, r.params.productId, r.identity!.userId, r.body.rating, r.body.title, r.body.comment ?? null, isVerifiedPurchase]
      );
      await audit(tx, r, 'product_review.created', row.id);
      return row;
    });

    return reply.code(201).send(review);
  });

  app.post('/reviews/:reviewId/vote', {
    preHandler: writers,
    schema: {
      tags: ['Product Reviews'],
      params: Type.Object({ reviewId: Id }),
      body: Obj({
        voteType: Type.Union([Type.Literal('helpful'), Type.Literal('not_helpful')])
      })
    }
  }, async (r) => {
    // Verify review exists and belongs to tenant
    const [review] = await app.db.query(
      'SELECT * FROM product_reviews WHERE tenant_id=$1 AND id=$2',
      [r.tenant!.id, r.params.reviewId]
    );
    if (!review) {
      throw new ApiError(404, 'REVIEW_NOT_FOUND', 'Review not found');
    }

    // Check if user already voted on this review
    const [existingVote] = await app.db.query(
      'SELECT * FROM review_votes WHERE tenant_id=$1 AND review_id=$2 AND customer_id=$3 AND vote_type=$4',
      [r.tenant!.id, r.params.reviewId, r.identity!.userId, r.body.voteType]
    );
    if (existingVote) {
      throw new ApiError(409, 'VOTE_EXISTS', 'You have already voted on this review');
    }

    const vote = await storeTransaction(app, r, async (tx) => {
      // Insert the vote
      await tx.query(
        'INSERT INTO review_votes(id,tenant_id,review_id,customer_id,vote_type) VALUES($1,$2,$3,$4,$5)',
        [randomUUID(), r.tenant!.id, r.params.reviewId, r.identity!.userId, r.body.voteType]
      );

      // Update the review's helpful/unhelpful vote counts
      if (r.body.voteType === 'helpful') {
        await tx.query(
          'UPDATE product_reviews SET helpful_votes = helpful_votes + 1, total_votes = total_votes + 1, updated_at=now() WHERE id=$1',
          [r.params.reviewId]
        );
      } else {
        await tx.query(
          'UPDATE product_reviews SET total_votes = total_votes + 1, updated_at=now() WHERE id=$1',
          [r.params.reviewId]
        );
      }

      await audit(tx, r, 'review_vote.created', r.params.reviewId, { voteType: r.body.voteType });

      // Return updated review
      const [updatedReview] = await tx.query(
        'SELECT * FROM product_reviews WHERE id=$1',
        [r.params.reviewId]
      );
      return updatedReview;
    });

    return vote;
  });

  app.delete('/reviews/:reviewId', {
    preHandler: admins,
    schema: {
      tags: ['Product Reviews'],
      params: Type.Object({ reviewId: Id })
    }
  }, async (r, reply) => {
    await storeTransaction(app, r, async (tx) => {
      // Verify review exists and belongs to tenant
      const [review] = await tx.query(
        'SELECT id FROM product_reviews WHERE tenant_id=$1 AND id=$2',
        [r.tenant!.id, r.params.reviewId]
      );
      if (!review) {
        throw new ApiError(404, 'REVIEW_NOT_FOUND', 'Review not found');
      }

      // Delete associated votes first (due to foreign key constraints)
      await tx.query(
        'DELETE FROM review_votes WHERE tenant_id=$1 AND review_id=$2',
        [r.tenant!.id, r.params.reviewId]
      );

      // Delete the review
      const [row] = await tx.query(
        'DELETE FROM product_reviews WHERE tenant_id=$1 AND id=$2 RETURNING id',
        [r.tenant!.id, r.params.reviewId]
      );

      if (!row) {
        throw new ApiError(404, 'REVIEW_NOT_FOUND', 'Review not found');
      }

      await audit(tx, r, 'product_review.deleted', r.params.reviewId);
    });

    return reply.code(204).send();
  });
}