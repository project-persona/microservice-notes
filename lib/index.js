const { RpcWorker, RpcProvider } = require('@persona/infra/service-broker')

const MongoClient = require('mongodb').MongoClient
const MongoObjectID = require('mongodb').ObjectId
// const admin = require('firebase-admin')

const { MONGO_CONNECTION_STRING, MONGO_COLLECTION } = require('./config')

let db

// new RpcWorker (service, provider, address)
// - service: string, human readable service set name, preferably in plural form
// - RpcProvider: a class extends from RpcProvider
// - address: optional, ZeroMQ connection address, fallback to `BROKER_ADDR` env var when not provided
module.exports = new RpcWorker('notes', class extends RpcProvider {
  // a new instance of RpcProvider is created for each request, so anything mounted to `this` is only available for that
  // request only

  // a service-wide initializer: this hook will only run once for a service
  async [RpcProvider.init] () {
    // the init hook is perfect for initializing external services like databases:
    const client = new MongoClient(MONGO_CONNECTION_STRING)
    await client.connect()
    db = client.db('personas') // again, collection names are preferred to be in plural form
  }

  async [RpcProvider.before] () {
    if (this.context.type === 'system') {
      console.log('called by system context')
    }

    // if (!this.context.authorization) {
    //   console.log('User not logged in')
    // }
  }

  // TODO: most of this probably works, but havent been tested. More or less copied over from passwords microservice
  async create (personaId, note) {
    const noteObject = note.personaId = personaId
    try {
      const collection = db.collection(MONGO_COLLECTION)
      // insertOne automatically adds _id to the object. type is new ObjectId('id')
      await collection.insertOne(noteObject)
    } catch (err) {
      console.err(err)
    }
    return note
  }

  async list (personaId, count) {
    // todo: return list of object within count. This implies the collection has order
    try {
      const collection = db.collection(MONGO_COLLECTION)
      const searchCursor = await collection.find({ personaId: personaId })
      return await searchCursor.toArray()
    } catch (err) {
      console.log('Error during list: ', err)
    }
  }

  async show (personaId, id) {
    // TODO: handle type error
    try {
      const mongoObjectID = new MongoObjectID(id)
      const collection = db.collection(MONGO_COLLECTION)
      const searchCursor = await collection.find({ _id: mongoObjectID, personaId: personaId })

      const noteFound = await searchCursor.toArray()
      console.log('persona found:', noteFound)
      return noteFound
    } catch (err) {
      console.log(err)
      return -1
    }
  }

  async edit (personaId, id, note) {
    // ignore email and id from edit
    delete note.email
    delete note._id
    const mongoObjectID = new MongoObjectID(id)
    try {
      const collection = db.collection(MONGO_COLLECTION)
      return await collection.updateOne({ _id: mongoObjectID, personaId: personaId }, { $set: note })
    } catch (err) {
      console.log(err)
      return -1
    }
  }

  async delete (personaId, id) {
    const mongoObjectID = new MongoObjectID(id)
    try {
      const collection = db.collection(MONGO_COLLECTION)
      await collection.deleteOne({ _id: mongoObjectID, personaId: personaId })
    } catch (err) {
      console.log(err)
    }
  }

  // a request-scoped after hook: this hook runs for every request after your actually method
  async [RpcProvider.after] () {
    // the after hook is perfect your cleaning things up, if needed
  }
})
