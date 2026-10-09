import { Type } from '@sinclair/typebox';
export { Type };
export const Id = Type.String({ format: 'uuid' });
export const Text = (maxLength = 200) => Type.String({ minLength: 1, maxLength, pattern: '\\S' });
export const Email = Type.String({ format: 'email', maxLength: 254 });
export const Password = Type.String({ minLength: 12, maxLength: 128 });
export const Money = Type.Integer({ minimum: 0, maximum: 100_000_000 });
export const Address = Type.Object({
  line1: Type.Optional(Text()), line2: Type.Optional(Type.String({ maxLength: 200 })),
  city: Type.Optional(Text(100)), region: Type.Optional(Text(100)),
  postalCode: Type.Optional(Text(30)), country: Type.Optional(Type.String({ pattern: '^[A-Z]{2}$' })),
}, { additionalProperties: false });
export const Pagination = Type.Object({
  page: Type.Optional(Type.Integer({ minimum: 1, maximum: 10000, default: 1 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
}, { additionalProperties: false });
export const ParamsId = Type.Object({ id: Id });
export const Role = Type.Union([Type.Literal('owner'), Type.Literal('admin'), Type.Literal('staff'), Type.Literal('viewer')]);
export const Obj = <T extends Record<string, import('@sinclair/typebox').TSchema>>(properties: T) =>
  Type.Object(properties, { additionalProperties: false });
