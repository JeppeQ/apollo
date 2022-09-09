import { DateTime } from 'luxon';
import { PirateFleets, AvailableStates } from './enums.js'
import * as api from './queries.js'

function delay(time) {
  return new Promise(resolve => setTimeout(resolve, time));
}

class Apollo {
  constructor() {
    this.fleets = []
    this.availableFleets = []
    this.cargo = []

    this.zones = []
    this.targetedPlanets = []
    this.noPiratePlanets = false

    this.structureData = []
    this.structuresLastUpdated = null

    this.waitForMoreResources = false
  }

  async getCargo() {
    this.cargo = await api.getStorage()
  }

  async getFleets() {
    const fleets = await api.getFleets()

    if (!fleets) { console.log('NO FLEETS ERROR') }

    this.fleets = fleets
    this.availableFleets = fleets.filter(fleet => AvailableStates.includes(fleet.state)
      && !(fleet.ships.find(ship => ship.is_damaged) && fleet.state === 'Hangar')
      && !(this.noPiratePlanets && fleet.state === 'Hangar' && PirateFleets.includes(fleet.name))
      && !(this.waitForMoreResources && fleet.state === 'Hangar' && !PirateFleets.includes(fleet.name)))
  }

  async getZones() {
    this.zones = await api.getZones()
  }

  async getFreshPlanets() {
    let planets = []

    await this.getZones()

    await Promise.all(
      this.zones.map(async zone => {
        const events = await api.getEvents(zone)
        planets = planets.concat(events.filter(event => event.spec.type === 'Pirate' && DateTime.fromISO(event.start_time) > DateTime.now().minus({ minutes: 10 })))
      })
    )

    return planets
  }

  async getStructureData() {
    console.log('Updating structure data')
    let structures = []

    await this.getZones()

    await Promise.all(
      this.zones.map(async zone => {
        const events = await api.getStructureEvents(zone)
        structures = structures.concat(events)
      })
    )

    this.structureData = structures
    this.structuresLastUpdated = DateTime.utc()
  }

  getClosestDock(zone, position) {
    const docks = this.structureData.filter(s => s.zone_id === zone && s.spec.type === "Dock")

    const closestDock = docks.map(dock => {
      return {
        ...dock,
        distance: Math.hypot(dock.q - Number(position[0]), dock.r - Number(position[1]))
      }
    }).sort((a, b) => a.distance - b.distance)[0]

    return closestDock
  }

  getBestStructure(structureType, inputType) {
    let eStructures = this.structureData.filter(s => s.spec.type === structureType && s.spec.inputs[0].input_type === inputType).sort((a, b) => a.count_lurking_fleets - b.count_lurking_fleets)
    eStructures = eStructures.filter(s => s.count_lurking_fleets === eStructures[0].count_lurking_fleets)

    eStructures = eStructures.map(s => {
      const pos = [s.q, s.r]
      const dock = this.getClosestDock(s.zone_id, pos)

      return {
        id: s.id,
        position: pos,
        dockId: dock.id,
        distance: dock.distance,
        lurkers: s.count_lurking_fleets
      }
    }).sort((a, b) => a.distance - b.distance)

    return eStructures[0]
  }

  async returnToDock(fleet) {
    const position = fleet.zone_pos.slice(1, -1).split(",")

    const closestDock = this.getClosestDock(fleet.zone_id, position)

    await api.moveFleets([fleet], [closestDock.q, closestDock.r])
  }

  async searchPlanet(fleet) {
    const freshPlanets = await this.getFreshPlanets()

    if (freshPlanets.length < 1) {
      return
    }

    const impEvents = freshPlanets.filter(f => f.reward_type === "Imperium Ore" && !this.targetedPlanets.includes(f.id)).sort((a, b) => b.reward_left - a.reward_left)
    if (impEvents.length > 0) {
      const position = [impEvents[0].q, impEvents[0].r]
      const zone = this.zones.find(zone => zone === impEvents[0].zone_id)

      console.log("Launching fleet towards Imperium Ore", fleet.name)
      this.targetedPlanets.push(impEvents[0].id)
      return this.moveTo(fleet, zone, position)
    }

    const xetoEvents = freshPlanets.filter(f => f.reward_type === "Xeto Ore" && !this.targetedPlanets.includes(f.id)).sort((a, b) => b.reward_left - a.reward_left)
    if (xetoEvents.length > 0) {
      const position = [xetoEvents[0].q, xetoEvents[0].r]
      const zone = this.zones.find(zone => zone === xetoEvents[0].zone_id)

      console.log("Launching fleet towards Xeto Ore", fleet.name)
      this.targetedPlanets.push(xetoEvents[0].id)
      return this.moveTo(fleet, zone, position)
    }

    const ironEvents = freshPlanets.filter(f => f.reward_type === "Iron Ore" && f.reward_left > 75000 && !this.targetedPlanets.includes(f.id))
    if (ironEvents.length > 0 && this.waitForMoreResources) {
      const position = [ironEvents[0].q, ironEvents[0].r]
      const zone = this.zones.find(zone => zone === ironEvents[0].zone_id)

      console.log("Launching fleet towards Iron Ore", fleet.name)
      this.targetedPlanets.push(ironEvents[0].id)
      return this.moveTo(fleet, zone, position)
    }

    this.noPiratePlanets = true
  }

  async moveTo(fleet, zone, position) {
    const closestDock = this.getClosestDock(zone, position)

    // DEPLOY FLEET AT DOCK
    await api.launchFleets([fleet], closestDock.id)

    // MOVE FLEET
    await api.moveFleets([fleet], position)
  }

  async handlePirateFleets() {
    const fleets = this.availableFleets.filter(fleet => PirateFleets.includes(fleet.name))
    console.log(fleets.length, "pirate fleets ready")

    if (fleets.length < 1) return;

    return this.nextPirateAction(fleets)
  }

  async nextPirateAction(fleets) {
    if (fleets.length < 1) {
      return
    }

    const fleet = fleets.shift()

    const currentDock = this.structureData.find(s => s.spec.type === "Dock" && s.zone_id === fleet.zone_id && fleet.zone_pos === `(${[s.q, s.r].join(",")})`)

    const isDock = fleet.state === 'Hangar' ? true : currentDock

    if (fleet.state === 'Idle' && isDock) {
      console.log('Docking and unloading', fleet.name)
      await api.dockFleet(fleet, currentDock.id)
      await api.unloadFleet(fleet)
      this.waitForMoreResources = false
      return
    }

    if (isDock) {
      if (DateTime.now().toObject().minute <= 2) {
        console.log('Searching for pirate planet', fleet.name)
        await this.searchPlanet(fleet)
      } else {
        console.log('Taking a break', fleet.name)
      }

      return this.nextPirateAction(fleets)
    }

    const events = await api.getEvents(fleet.zone_id)
    const pirateEvent = events.find(e => `(${e.q},${e.r})` === fleet.zone_pos)
    if (pirateEvent && pirateEvent.spec.type === 'Pirate') {

      if (pirateEvent.reward_left < 12000) {
        console.log('Pirate event depleted, returning to base', fleet.name)
        return this.returnToDock(fleet)
      }

      if (fleet.ships.find(ship => ship.cargo.length > 0)) {
        console.log('Returning pirate haul to base', fleet.name)
        return this.returnToDock(fleet)
      }

      console.log('PIRATE TIME!', fleet.name)
      return api.fight(fleet, pirateEvent.id)
    }

    if (!isDock) {
      console.log('Returning to dock', fleet.name)
      return this.returnToDock(fleet)
    }

    return this.nextPirateAction(fleets)
  }

  async handleTradingFleets() {
    const fleets = this.availableFleets.filter(fleet => !PirateFleets.includes(fleet.name))
    console.log(fleets.length, "trading fleets ready")

    if (fleets.length < 1) return;

    return this.nextTradingAction(fleets)
  }

  async nextTradingAction(fleets) {
    if (fleets.length < 1) {
      return
    }

    const fleet = fleets.shift()

    const currentDock = this.structureData.find(s => s.spec.type === "Dock" && s.zone_id === fleet.zone_id && fleet.zone_pos === `(${[s.q, s.r].join(",")})`)

    const isDock = fleet.state === 'Hangar' ? true : currentDock

    if (fleet.state === 'Idle' && isDock) {
      console.log('Docking and unloading', fleet.name)
      await api.dockFleet(fleet, currentDock.id)
      await api.unloadFleet(fleet)
      this.waitForMoreResources = false
    }

    else if (fleet.ships.find(ship => ship.is_damaged) && fleet.state === 'Idle') {
      console.log('Returning damaged ship', fleet.name)
      await this.returnToDock(fleet)
    }

    else if (fleet.state === 'Idle') {
      const structure = this.structureData.find(s => s.zone_id === fleet.zone_id && fleet.zone_pos === `(${[s.q, s.r].join(",")})`)
      const resources = fleet.ships[0].cargo.find(c => c.resource_type === structure.spec.inputs[0].input_type)

      if (!structure || !resources || resources.amount < structure.spec.inputs[0].input_ratio) {
        console.log('Returning to base', fleet.name)
        return this.returnToDock(fleet)
      }

      console.log('Trading/refining', fleet.name)
      await api.stuctureInteract(fleet, structure.id)
    }

    else if (fleet.state === 'Hangar') {
      await this.getCargo()
      await this.pickResource(fleet)
    }

    return this.nextTradingAction(fleets)
  }

  async pickResource(fleet) {
    const storage = fleet.ships.length * 5000

    let type
    let structure

    if (this.cargo.find(c => c.resource_type === 'Imperium' && c.amount >= storage)) {
      type = 'Imperium'
      structure = this.getBestStructure("TradeHouse", 'Imperium')
    }

    else if (this.cargo.find(c => c.resource_type === 'Imperium Ore' && c.amount >= storage)) {
      type = 'Imperium Ore'
      structure = this.getBestStructure("Refinery", 'Imperium Ore')
    }

    else if (this.cargo.find(c => c.resource_type === 'Xeto' && c.amount >= storage)) {
      type = 'Xeto'
      structure = this.getBestStructure("TradeHouse", 'Xeto')
    }

    else if (this.cargo.find(c => c.resource_type === 'Xeto Ore' && c.amount >= storage)) {
      type = 'Xeto Ore'
      structure = this.getBestStructure("Refinery", 'Xeto Ore')
    }

    else if (this.cargo.find(c => c.resource_type === 'Iron' && c.amount >= storage)) {
      type = 'Iron'
      structure = this.getBestStructure("TradeHouse", 'Iron')
    }

    else if (this.cargo.find(c => c.resource_type === 'Iron Ore' && c.amount >= storage)) {
      type = 'Iron Ore'
      structure = this.getBestStructure("Refinery", 'Iron Ore')
    }

    if (!type || !structure) {
      console.log('Waiting for new resources', fleet.name)
      this.waitForMoreResources = true
      return
    };

    console.log('LAUNCHING FLEET TO', fleet.name, structure)
    await api.loadFleet(fleet, type)
    await api.launchFleets([fleet], structure.dockId)
    await api.moveFleets([fleet], structure.position)
  }

  getEndTimes() {
    const endTimes = this.fleets.map(fleet => {
      if (fleet.state === 'Moving') {
        return fleet.zone_movement_end_time
      }

      if (fleet.state === 'InEvent') {
        return fleet.current_zone_event[0].end_time
      }
    })

    return endTimes.sort()
  }

  async main() {

    let i = 0
    while (true) {

      if (!this.structuresLastUpdated || this.structuresLastUpdated.diff(DateTime.utc(), ['minutes']).minutes > 30) {
        await this.getStructureData()
      }

      await this.getFleets()

      const pirateFleetsHanging = this.availableFleets.filter(fleet => PirateFleets.includes(fleet.name) && fleet.state === 'Hangar')
      const onlyPirate = pirateFleetsHanging.length === this.availableFleets.length && DateTime.now().toObject().minute >= 2

      if (!onlyPirate && this.availableFleets.length > 0) {

        await this.handlePirateFleets()
        await this.handleTradingFleets()

      } else {
        this.noPiratePlanets = false
        this.targetedPlanets = []

        const endTimes = this.getEndTimes()
        const { seconds } = DateTime.fromISO(endTimes[0]).diff(DateTime.utc(), ['seconds'])

        const onlyPirateMove = (onlyPirate ? 60 - DateTime.now().toObject().minute : 240) * 60
        const wait = Math.ceil(Math.min(onlyPirateMove, seconds) + 2)

        console.log("Next fleet ready in minutes:", Math.round(wait / 60))
        await delay(wait * 1000)
      }

    }

  }
}

let apollo = new Apollo()
apollo.main()