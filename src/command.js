import { Parser } from '../node_modules/@author.io/arg/index.js'
// import Shell from './shell.js'

const STRIP_EQUAL_SIGNS = /(\=+)(?=([^'"\\]*(\\.|['"]([^'"\\]*\\.)*[^'"\\]*['"]))*[^'"]*$)/g
const SUBCOMMAND_PATTERN = /^([^"'][\S\b]+)[\s+]?([^-].*)$/i
const FLAG_PATTERN = /((?:"[^"\\]*(?:\\[\S\s][^"\\]*)*"|'[^'\\]*(?:\\[\S\s][^'\\]*)*'|\/[^\/\\]*(?:\\[\S\s][^\/\\]*)*\/[gimy]*(?=\s|$)|(?:\\\s|\S))+)(?=\s|$)/g

export default class Command {
  #pattern
  #oid
  #name
  #description
  #aliases
  #customUsage
  #customHelp
  #fn
  #flagConfig = null
  #subcommands = new Map()
  #processors = new Map()
  #autohelp = true
  #parent = null
  #shell = null
  #tabWidth
  #tableWidth
  #hasCustomDefaultMethod = false
  #defaultMethod = data => console.log(this.help)

  constructor (cfg = {}) {
    if (typeof cfg !== 'object') {
      throw new Error('Invalid command configuration. Expected an object.')
    }

    if (!cfg.hasOwnProperty('name')) {
      throw new Error('Invalid command configuration. A "name" attribute is required.')
    }

    if (cfg.handler && typeof cfg.handler !== 'function') {
      throw new Error('Invalid command configuration. A "handler" function is required.')
    }

    this.#name = cfg.name.trim().split(/\s+/)[0]
    this.#fn = cfg.handler
    this.#oid = Symbol(((cfg.name || cfg.usage) || cfg.pattern) || 'command')
    this.#pattern = cfg.pattern || /[\s\S]+/i
    this.#customUsage = cfg.usage || null
    this.#customHelp = cfg.help || null
    this.aliases = cfg.aliases
    this.#description = cfg.description || null
    this.#tabWidth = cfg.hasOwnProperty('tabWidth') ? cfg.tabWidth : 4
    this.#tableWidth = cfg.hasOwnProperty('tableWidth') ? cfg.tableWidth : 70

    if (cfg.alias) {
      if (Array.isArray(cfg.alias)) {
        this.aliases = cfg.alias
      } else {      
        this.aliases.push(cfg.alias)
      }
    }

    if (cfg.flags) {
      if (typeof cfg.flags !== 'object') {
        throw new Error(`Invalid flag configuration (expected and object, received ${typeof cfg.flags}).`)
      }

      this.#flagConfig = cfg.flags
    }

    if (typeof cfg.autohelp === 'boolean') {
      this.#autohelp = cfg.autohelp
    }

    if (typeof cfg.defaultMethod === 'function') {
      this.defaultMethod = cfg.defaultMethod
    }

    if (Array.isArray(cfg.commands)) {
      cfg.commands.forEach(cmd => this.add(cmd))
    }

    if (Array.isArray(cfg.subcommands)) {
      cfg.subcommands.forEach(cmd => this.add(cmd))
    }
  }

  set tableWidth(value) {
    this.#tableWidth = value
    this.#processors.forEach(cmd => cmd.tableWidth = value)
  }

  set tabWidth(value) {
    this.#tabWidth = value
    this.#processors.forEach(cmd => cmd.tabWidth = value)
  }

  // @private
  set defaultHandler (value) {
    if (typeof value === 'function') {
      this.#defaultMethod = value
      this.#hasCustomDefaultMethod = true
      this.#processors.forEach(cmd => cmd.defaultProcessor = value)
    } else {
      throw new Error(`Invalid default method (must be a function, not ${typeof cfg.defaultMethod}).`)
    }
  }

  // @private
  get hasCustomDefaultMethod () {
    return this.#hasCustomDefaultMethod
  }

  set parent (cmd) {
    if (cmd instanceof Command) {
      this.#parent = cmd
    }
  }

  set shell (shell) {
    this.#shell = shell
  }

  get shell () {
    if (!this.#shell) {
      if (this.#parent) {
        return this.#parent.shell
      }
      return ''
    }

    return this.#shell.name
  }

  get autohelp() {
    return this.#autohelp
  }

  set autohelp(value) {
    if (typeof value !== 'boolean') {
      return
    }
    this.#autohelp = value
    this.#processors.forEach(cmd => cmd.autohelp = value)
  }

  get subcommands () {
    return this.#processors
  }

  get name () {
    return this.#name
  }

  get description () {
    return this.#description || this.usage
  }

  get commandroot () {
    if (this.#parent) {
      return `${this.#parent.commandroot} ${this.#name}`.trim()
    }
    
    if (this.#shell) {
      return `${this.#shell.name} ${this.#name}`.trim()
    }
    
    return this.#name
  }

  get usage () {
    if (this.#customUsage) {
      return typeof this.#customUsage === 'function' ? this.#customUsage() : this.#customUsage
    }

    const a = Array.from(this.#aliases)
    const msg = [`${this.commandroot}${a.length > 0 ? ' <' + a.join(', ') + '> ' : ''} [OPTIONS]`.trim()]

    if (this.#description.trim().length > 0) {
      msg.push('\n  ' + this.#description.trim())
    }
    return msg.join('\n').trim()
  }

  set usage (value) {
    this.#customUsage = value
  }

  get help () {
    if (this.#customHelp) {
      return typeof this.#customHelp === 'function' ? this.#customHelp() : this.#customHelp
    }

    let maxWidth = this.#tableWidth
    let tabWidth = this.#tabWidth

    let msg = [this.usage + '\n']
    let flags = Object.keys(this.#flagConfig || {}).filter(f => f !== 'help')
    if (flags.length > 0) {
      msg.push('Options:\n')
      
      flags.forEach(flag => {
        let message = `  -${flag}`
        flag = this.#flagConfig[flag]
        flag.alias = Array.isArray(flag.alias) ? flag.alias : [flag.alias]
        if (flag.aliases) {
          flag.alias = flag.alias.concat(flag.aliases)
        }
        flag.alias = new Set(flag.alias.filter(a => typeof a === 'string'))

        if (flag.alias.size > 0) {
          message += ` [${Array.from(flag.alias).map(a => '-'+a).join(', ')}]`
        }
        message += '\t'

        let desc = []
        let tabs = message.match(/\t/gi).length
        let prefixLength = message.length + 2 + (this.#tabWidth*tabs)
        let dsc = new String(flag.description)
        const match = new RegExp(`(.{0,${this.#tableWidth-prefixLength}}[\\s\n])`, 'g')
        
        desc = flag.description.match(match)
        desc.push(dsc.replace(desc.join(''), ''))

        while (desc.length > 1 && desc[desc.length - 1].length + desc[desc.length - 2].length < (this.#tableWidth-prefixLength)) {
          desc[desc.length - 2] += desc.pop()
        }
        
        desc = desc.reverse().map(item => item.trim())
        
        if (desc.length > 0) {
          let prefix = ''
          for (let i = 0; i < prefixLength; i++) {
            prefix += ' '
          }
          
          message += ' : ' + desc.pop()
          while (desc.length > 0) {
            message += `\n${prefix}${desc.pop()}`
          }
        }
        
        msg.push(message)
      })
    } else if (this.#processors.size > 0) {
      msg.push('Options:\n')
    }

    this.#processors.forEach(proc => {
      let message = `  ${ proc.name }: \t  ${ proc.description } `

      if (proc.aliases.length > 0) {
        message = `${ message } Aliases: ${ proc.aliases.join(', ') }.`
      }
      msg.push(message)
    })

    let tab = ''
    for (let i = 0; i < tabWidth; i++) {
      tab += ' '
    }

    return (msg.join('\n') + '\n').replace(/\n{2,}$/, '\n').replace(/\t/gi, tab)
    // return `${this.#name} help goes here`
  }

  set help (value) {
    this.#customHelp = value
  }

  set aliases (value) {
    if (!value) {
      this.#aliases = []
      return
    }

    if (typeof value === 'object') {
      switch (value.constructor.name.toLowerCase()) {
        case 'map':
          value = Array.from(value.keys())
          break
        case 'set':
          value = Array.from(value)
          break
        case 'object':
          value = Object.keys(value).filter(item => typeof item === 'string')
          break
        case 'array':
          break
        case 'string':
          value = value.split(/\s+/)[0]
          break
        default:
          throw new Error('Invalid alias value. Use an array of strings.')
      }
    }

    this.#aliases = Array.from(new Set(value)) // This conversion deduplicates the value
  }

  get aliases () {
    return this.#aliases
  }

  get OID () {
    return this.#oid
  }

  addFlag (name, cfg) {
    if (typeof name !== 'string') {
      throw new Error('Invalid flag name (should be a string).')
    }

    this.#flagConfig = this.#flagConfig || {}
    this.#flagConfig[name] = cfg
  }

  removeFlag (name) {
    delete this.#flagConfig[name]
  }

  supportsFlag (name) {
    return this.#flagConfig.hasOwnProperty(name)
  }

  add (command) {
    if (!(command instanceof Command)) {
      if (typeof command === 'object') {
        command = new Command(command)
      } else {
        throw new Error('Invalid argument. Only "Command" instances may be added to the processor.')
      }
    }

    command.parent = this
    command.autohelp = this.#autohelp
    command.tabWidth = this.#tabWidth
    command.tableWidth = this.#tableWidth

    this.#processors.set(command.OID, command)
    this.#subcommands.set(command.name, command.OID)
    
    command.aliases.forEach(alias => this.#subcommands.set(alias, command.OID))
  }

  remove () {
    for (const cmd of arguments) {
      if (typeof cmd === 'symbol') {
        this.#processors.delete(cmd)
        this.#subcommands.forEach(oid => oid === cmd && this.#subcommands.delete(oid))
      }
      
      if (typeof cmd === 'string') {
        const OID = this.#subcommands.get(cmd)
        if (OID) {
          this.remove(OID)
        }
      }
    }
  }

  async run (input, callback) {
    const parsed = SUBCOMMAND_PATTERN.exec(input)

    // Parse the command input for flags
    const data = { command: this.#name, input: input.trim() }

    let flagConfig = this.#flagConfig || {}
      
    if (!flagConfig.hasOwnProperty('help')) {
      flagConfig.help = {
        description: `Display ${ this.#name } help.`,
        aliases: ['h'],
        default: false,
        type: 'boolean'
      }
    }

    let source = input.replace(STRIP_EQUAL_SIGNS, '').trim() + ' '
    const flags = Array.from(FLAG_PATTERN[Symbol.matchAll](source), x => x[0])
    const parser = new Parser(flags, flagConfig)
    let recognized = parser.data

    parser.unrecognizedFlags.forEach(arg => delete recognized[arg])

    data.flags = { recognized, unrecognized: parser.unrecognizedFlags }
    data.valid = parser.valid
    data.violations = parser.violations
  
    data.help = {
      requested: recognized.help
    }

    if (recognized.help) {
      data.help.message = this.help
    }

    delete recognized.help

    let fn = this.#fn || this.#defaultMethod

    // A possible subcommand was input
    if (parsed) {
      let cmd = parsed[1]
      let args = parsed.length > 2 ? parsed[2] : ''
      let command = null
      let subcommand = this.#subcommands.get(cmd)

      if (!subcommand) {
        for (const [name, id] of this.#subcommands) {
          const subcmd = this.#processors.get(id)
          
          if (subcmd.aliases.indexOf(cmd)) {
            subcommand = subcmd
            break
          }
        }
      }

      // If the prospective subcommand is not recognized, run the main processor
      if (!subcommand) {
        return await (new Promise((resolve, reject) => {
          try {
            if (this.#autohelp && data.help.requested) {
              console.log(this.help)
              resolve()
            } else if (callback) {
              fn(data, callback)
              resolve()
            } else {
              resolve(fn(data))
            }
          } catch (e) {
            reject(e)
          }
        }))
      }

      const processor = this.#processors.get(subcommand)

      if (this.#autohelp) {
        if (data.help.requested) {
          if (processor) {
            return console.log(processor.help)
          } else {
            return console.log(this.help)
          }
        }
      }

      if (!processor) {
        throw new Error(`${this.#name} "${cmd}" command not found.`)
      }

      return Command.reply(await processor.run(args, callback))
    }

    // No subcommand was recognized
    return Command.reply(fn(data, callback))
  }

  static stderr (err) {
    if (err instanceof Error) {
      return new Promise((resolve, reject) => reject(err))
    }

    return new Promise((resolve, reject) => reject(err))
  }

  static reply (callback) {
    return new Promise((resolve, reject) => {
      try {
        if (typeof callback === 'function') {
          callback()
        }
        resolve()
      } catch (e) {
        reject(e)
      }
    })
  }
}