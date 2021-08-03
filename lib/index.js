const { RpcWorker, RpcProvider } = require('@persona/infra/service-broker')

const { MongoClient, ObjectId } = require('mongodb')
const admin = require('firebase-admin')
const Parameter = require('parameter')
const dot = require('mongo-dot-notation')

const {
  MONGO_CONNECTION_STRING,
  MONGO_DB,
  NOTE_COLLECTION,
  GOOGLE_APPLICATION_CREDENTIALS
} = require('./config')

const RULES = {
  title: {
    type: 'string'
  },
  content: {
    type: 'string'
  }
}

function validate (document) {
  const rules = {}
  const data = {}
  for (const key of Object.keys(document)) {
    rules[key] = RULES[key]
    data[key] = document[key]
  }

  const validator = new Parameter()
  const errors = validator.validate(rules, data)
  if (errors) {
    throw new Error(errors[0].field + ' ' + errors[0].message)
  }
}

let notes

module.exports = new RpcWorker('notes', class extends RpcProvider {
  async [RpcProvider.init] () {
    const client = new MongoClient(MONGO_CONNECTION_STRING)
    await client.connect()
    notes = client.db(MONGO_DB).collection(NOTE_COLLECTION)

    admin.initializeApp({
      credential: admin.credential.cert(require(GOOGLE_APPLICATION_CREDENTIALS))
    })
  }

  async [RpcProvider.before] () {
    if (this.context.type === 'system') {
      return
    }

    if (!this.context.authorization) {
      throw new Error('User not logged in')
    }

    this.user = await admin.auth().verifyIdToken(this.context.authorization.substring('Bearer '.length))
  }

  /**
   * creates a new note object
   *
   * @param personaId the persona to associate with
   * @param note full note object ('_id', 'personaId', 'dateCreated', and 'dateModified' are ignored)
   */
  async create (personaId, note) {
    note = note || {}

    await this.services.personas.show(personaId)

    const { title, content } = note
    const payload = { title, content }

    validate(payload)

    payload.dateCreated = new Date()
    payload.dateModified = payload.dateCreated
    payload.personaId = personaId

    const { insertedId } = await notes.insertOne(payload)

    return {
      _id: insertedId,
      ...payload
    }
  }

  /**
   * list all notes associated with a specific persona, sorted by decreasing dateModified
   *
   * @param personaId
   * @return {Promise<[?]>}
   */
  async list (personaId) {
    await this.services.personas.show(personaId)

    return await notes.find({ personaId }).sort({ dateModified: -1 }).toArray()
  }

  /**
   * returns the credential with requested id if current logged in user has access to it
   *
   * @param id
   * @return {Promise<?>}
   */
  async show (id) {
    const note = await notes.findOne({ _id: ObjectId(id) })

    if (!note) {
      throw new Error('Requested note doesn\'t exists or currently logged in user has no permission to access it')
    }

    await this.services.personas.show(note.personaId)

    return note
  }

  /**
   * edits the requested note with a full or partial note object
   *
   * @param id password id
   * @param note partial or full note object
   * @return {Promise<?>} modified note object
   */
  async edit (id, note) {
    note = note || {}

    await this.show(id)

    const acceptableKeys = ['title', 'content']
    const payload = Object.keys(note)
      .filter(key => acceptableKeys.includes(key))
      .reduce((obj, key) => {
        obj[key] = note[key]
        return obj
      }, {})

    validate(payload)

    payload.dateModified = new Date()

    await notes.updateOne({
      _id: ObjectId(id)
    }, dot.flatten(payload))

    return await this.show(id)
  }

  /**
   * deletes the requested note
   *
   * @param id note id
   * @return {Promise<null>} literally 'null'
   */
  async delete (id) {
    await this.show(id)
    await notes.deleteOne({ _id: ObjectId(id) })
    return null
  }
})
