import { Schema, model } from 'mongoose';

const noteSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    content: { type: String, default: '', maxlength: 20000 },
  },
  { timestamps: true },
);

// "My notes" list: equality on owner, newest first. Also covers countDocuments({ owner })
// and deleteMany({ owner }) when an admin removes a user.
noteSchema.index({ owner: 1, _id: -1 });

// Single note reads/updates and the admin "all notes" list (sorted by _id) use the default _id index.

export const Note = model('Note', noteSchema);
