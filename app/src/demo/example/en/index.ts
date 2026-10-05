import type { ExampleContent } from '../types';
import { documents } from './documents';

export const en: ExampleContent = {
  project: {
    name: 'Growing together — community gardens and wellbeing',
    description:
      'A fictional example study: interviews, a focus group, field notes and survey answers from three community gardens in an imaginary town. Explore it freely; nothing here is real.',
  },
  coders: { researcher: 'Ana', second: 'Rui' },
  speakers: { interviewer: 'Interviewer', moderator: 'Moderator' },
  groups: { interviews: 'Interviews', focus: 'Focus group & notes' },
  attributes: {
    age: { name: 'Age', description: 'Age in years at the time of the interview.' },
    gender: { name: 'Gender', description: 'As described by the participant.' },
    years: { name: 'Years gardening', description: 'Years at the community garden.' },
    neighbourhood: { name: 'Neighbourhood', description: 'Where the participant’s garden is.' },
    role: { name: 'Role', description: 'Main role in the garden.' },
  },
  options: {
    gender: ['Woman', 'Man', 'Non-binary'],
    neighbourhood: ['Mulberry Vale', 'Northbank', 'Kiln Hill'],
    role: ['Plot holder', 'Volunteer', 'Coordinator'],
  },
  surveyQuestions: [
    'What, if anything, has changed in your life since you started at the garden?',
    'What would make the garden better for you?',
  ],
  cases: {
    p1: { name: 'Margaret', description: 'Retired; widowed four years ago. Plot holder at Mulberry Vale since the garden’s early days.' },
    p2: { name: 'Daniel', description: 'Shift manager in logistics; moved to Northbank three years ago.' },
    p3: { name: 'Helen', description: 'Coordinator of the Mulberry Vale garden; works part-time.' },
    p4: { name: 'Arthur', description: 'Former brickworks employee; the longest-standing plot holder at Kiln Hill.' },
    p5: { name: 'Amina', description: 'Arrived three years ago; volunteers at the welcome table of the group plot.' },
    p6: { name: 'Steve', description: 'Came through social prescribing after redundancy; runs the Tuesday volunteer group.' },
    r1: { name: 'R01', description: 'Survey respondent.' },
    r2: { name: 'R02', description: 'Survey respondent.' },
    r3: { name: 'R03', description: 'Survey respondent.' },
    r4: { name: 'R04', description: 'Survey respondent.' },
    r5: { name: 'R05', description: 'Survey respondent.' },
  },
  codes: {
    community: {
      name: 'Belonging & community',
      description: 'How the garden connects people with each other: who is in, who is out, and how that changes.',
      inclusion: '', exclusion: '', example: '',
    },
    belonging: {
      name: 'Belonging',
      description: 'Feeling part of the garden or the neighbourhood; being accepted, known or missed.',
      inclusion: 'Statements about friendship, acceptance, being known by name, feeling at home.',
      exclusion: 'The first weeks of someone new (use Newcomers); exchanges between generations (use Intergenerational exchange).',
      example: '“Here nobody needs my papers. The potatoes don’t care where I am from.” (Amina)',
    },
    intergenerational: {
      name: 'Intergenerational exchange',
      description: 'Knowledge, help or care passing between older and younger people, in either direction.',
      inclusion: 'Teaching, learning or shared activity where the age difference matters to the speaker.',
      exclusion: 'Growing know-how passed between peers (use Seasonal knowledge).',
      example: '“I showed him how to save tomato seeds. Fair trade, I call it.” (Margaret)',
    },
    conflict: {
      name: 'Conflict over plots',
      description: 'Disputes about plots, boundaries, water, shared spaces and facilities, or who deserves a plot.',
      inclusion: 'Arguments, complaints, accusations, theft, tension between groups of plot holders.',
      exclusion: 'Disagreements that are only about the rules themselves, without a dispute between people (use Rules & governance).',
      example: '“Somebody’s squash grows over the path and suddenly it’s a war.” (Jamal, focus group)',
    },
    newcomers: {
      name: 'Newcomers',
      description: 'Arriving at the garden: first impressions, shyness, learning the unwritten rules, being welcomed or not.',
      inclusion: 'Accounts of the speaker’s own arrival or of how new members are seen by others.',
      exclusion: 'Newcomers to the neighbourhood in general (use Neighbourhood change).',
      example: '“I sat in the car outside for twenty minutes.” (Steve)',
    },
    wellbeing: {
      name: 'Wellbeing',
      description: 'Effects of gardening on physical and mental health, as participants describe them.',
      inclusion: '', exclusion: '', example: '',
    },
    stress: {
      name: 'Stress relief',
      description: 'The garden as a break from worry, work or noise; calm, rest for the mind.',
      inclusion: 'Calm, switching off, anxiety eased, “my head rests”.',
      exclusion: 'Sadness after a death or loss (use Grief & loss).',
      example: '“It’s the only time my brain shuts up.” (Steve)',
    },
    physical: {
      name: 'Physical activity',
      description: 'Bodily effort, fitness, mobility and sleep linked to the work in the garden.',
      inclusion: 'Digging, carrying, moving to stay well, being physically tired.',
      exclusion: 'Statements about health services (use Municipal support).',
      example: '“Moving keeps you going. You stop, you seize up, like an old lock.” (Arthur)',
    },
    grief: {
      name: 'Grief & loss',
      description: 'Bereavement, separation and other losses, and the garden’s place in living with them.',
      inclusion: 'Death of a partner or relative, a loved one going into care, mourning at a distance.',
      exclusion: 'Loss of a job (use Sense of purpose) or of the old neighbourhood (use Neighbourhood change).',
      example: '“It became the place where I could be sad without anybody fussing.” (Margaret)',
    },
    purpose: {
      name: 'Sense of purpose',
      description: 'A reason to get up, a routine, being useful to others.',
      inclusion: 'Structure to the week, responsibility, giving back, meaningful work.',
      exclusion: 'Exercise for its own sake (use Physical activity).',
      example: '“It gave the week a shape again.” (Steve)',
    },
    food: {
      name: 'Food & sustainability',
      description: 'What the garden produces and what people learn about food and the seasons.',
      inclusion: '', exclusion: '', example: '',
    },
    foodSecurity: {
      name: 'Food security',
      description: 'The garden’s produce as a real part of a household’s food, or of food aid.',
      inclusion: 'Money saved, families relying on produce, food banks, veg boxes.',
      exclusion: 'Giving produce away as a gesture (use Sharing produce).',
      example: '“If the plot went, we’d notice it at the till.” (Rosa, focus group)',
    },
    sharing: {
      name: 'Sharing produce',
      description: 'Giving, swapping and cooking produce together.',
      inclusion: 'Surplus tables, bags on the gate, trades between plots, shared meals.',
      exclusion: 'Organised food aid where the point is need (use Food security).',
      example: '“We trade. I give them rhubarb, they give me dill.” (Arthur)',
    },
    seasonal: {
      name: 'Seasonal knowledge',
      description: 'Know-how about when and how to grow, how it is learned, and how a changing climate unsettles it.',
      inclusion: 'Planting times, signs in nature, tips from other gardeners, eating with the seasons.',
      exclusion: 'Learning that is about the relationship between generations (use Intergenerational exchange).',
      example: '“The calendar on the packet is written for somewhere else.” (Arthur)',
    },
    place: {
      name: 'Place & nature',
      description: 'The garden as a place: its living things, and the neighbourhood around it.',
      inclusion: '', exclusion: '', example: '',
    },
    nature: {
      name: 'Contact with nature',
      description: 'Birds, animals, plants, weather and light noticed and valued for themselves.',
      inclusion: 'Descriptions of wildlife, the pond, early mornings, the garden as a “church”.',
      exclusion: 'Weather as a growing problem (use Seasonal knowledge).',
      example: '“Mist on the beds, blackbird going, a fox crossing the path like he owns it.” (Arthur)',
    },
    change: {
      name: 'Neighbourhood change',
      description: 'How the area around the garden has changed: closures, new buildings, new people.',
      inclusion: 'Lost workplaces, pubs and community centres; new cafés and flats.',
      exclusion: 'Rising rents and displacement (use the child code Gentrification).',
      example: '“The pub’s gone, the community centre is flats.” (Steve)',
    },
    gentrification: {
      name: 'Gentrification',
      description: 'Rising housing costs, displacement and pressure on land, and how participants position themselves in it.',
      inclusion: 'Rents, being priced out, housing pressure on the garden’s land, guilt or resentment about it.',
      exclusion: 'Change without a cost or displacement angle (use Neighbourhood change).',
      example: '“I know that people like me are part of the problem.” (Daniel)',
    },
    organisation: {
      name: 'Organisation',
      description: 'How the garden is run: rules, committees, volunteers and outside support.',
      inclusion: '', exclusion: '', example: '',
    },
    rules: {
      name: 'Rules & governance',
      description: 'Written and unwritten rules, committee decisions, inspections and how rules are explained.',
      inclusion: 'Making, enforcing, bending or not understanding rules; compromises reached by the committee.',
      exclusion: 'The dispute that led to a rule (use Conflict over plots).',
      example: '“Rules are fine as long as somebody explains them.” (Peter, focus group)',
    },
    waitingList: {
      name: 'Waiting list',
      description: 'Waiting for a plot, and how places are allocated.',
      inclusion: 'Length of the wait, exceptions to first come first served.',
      exclusion: '',
      example: '“There’s a waiting list now as long as your arm.” (Margaret)',
    },
    municipal: {
      name: 'Municipal support',
      description: 'Support, or its absence, from the council and other public services (funding, water, land, referrals).',
      inclusion: 'Grants, cuts, repairs, visits by officials, GP referrals and social prescribing.',
      exclusion: 'Support among gardeners themselves (use Belonging).',
      example: '“They’re very good at sending leaflets and not so good at sending plumbers.” (Margaret)',
    },
    burden: {
      name: 'Volunteering burden',
      description: 'The weight of running the garden falling on a few people.',
      inclusion: 'Hours given, burnout, feeling indispensable, guilt of those who do less.',
      exclusion: 'Ordinary gardening effort on one’s own plot (use Physical activity).',
      example: '“If three people left tomorrow, I’m not sure the garden would survive.” (Helen)',
    },
  },
  documents,
  memos: [
    {
      target: { kind: 'project' },
      title: 'Research questions',
      body: [
        '## Research questions',
        '',
        '1. How do community gardens shape participants’ sense of **belonging** in neighbourhoods that are changing fast?',
        '2. What **wellbeing** benefits do participants describe, and who seems to benefit most?',
        '3. How do the ways gardens are **organised** (rules, volunteers, council support) make those benefits possible, or limit them?',
        '',
        '## Material',
        '',
        '- Six semi-structured interviews (two coded by Rui as well, for agreement)',
        '- One focus group at the Northbank garden',
        '- Field notes from the Mulberry Vale open day',
        '- Five open survey answers',
        '',
        'All names are pseudonyms. Consent forms are stored separately, not in this project.',
      ].join('\n'),
    },
    {
      target: { kind: 'code', code: 'belonging' },
      title: 'Belonging without questions',
      body:
        'Several participants describe belonging as *not being asked* things: Amina (“nobody needs my papers”), Margaret (“nobody said a word, they just let me be”), Steve (“nobody asked me to talk about my feelings”). Belonging here is built through **working side by side**, not through conversation. Check whether this holds for the survey respondents too.',
    },
    {
      target: { kind: 'code', code: 'burden' },
      title: 'Who carries the garden?',
      body:
        'The same few names come up again and again (Helen, Steve, the “same five people” in R05). The wellbeing the garden gives to many seems to rest on the unpaid work of a few, some of whom came for their own wellbeing. Possible theme: **the cost of care**. Compare coordinators’ and plot holders’ accounts.',
    },
    {
      target: { kind: 'document', doc: 'int3' },
      title: 'Interview 3: the coordinator’s view',
      body:
        'Helen is the only interviewee who sees the garden mainly from the inside of its organisation. Much of what others call “the rules” or “the committee” is, in her account, a person answering the phone at half past ten at night. The GP referral exception is a good example of how rules carry values (“we’re not just a vegetable club”).',
    },
    {
      target: { kind: 'document', doc: 'focus' },
      title: 'Focus group: dynamics',
      body:
        'Peter speaks most about weather and rules; Rosa brings the conversation back to food and money each time. The water dispute was clearly painful for Rosa and the group moved on quickly. Jamal acts as a bridge between old and new plot holders, much like Daniel describes himself in interview 2.',
    },
    {
      target: { kind: 'case', case: 'p1' },
      title: 'Margaret',
      body:
        'Widowed four years ago. The garden appears as a place to grieve “without anybody fussing” and as daily structure (“somewhere to go in the morning”). Her account of the shed dispute links conflict over shared spaces with memory and loss. Follow-up: does she want to be involved in the open day next year?',
    },
    {
      target: { kind: 'coding', doc: 'int6', code: 'burden', quote: 'I nearly burnt out. Which is ironic, given why I came.' },
      title: 'The therapeutic garden that exhausts',
      body:
        'Steve names the paradox himself: the place that helped him recover is now a source of strain. Look for the same pattern in Helen (interview 3) and in R05. This could become a central argument about the limits of social prescribing without paid staff.',
    },
    {
      target: { kind: 'coding', doc: 'int5', code: 'belonging', quote: 'Here nobody needs my papers. The potatoes don’t care where I am from.' },
      title: 'Belonging as freedom from scrutiny',
      body:
        'Amina contrasts the garden with “the papers, the office, the doctor”. Belonging is defined against institutional scrutiny. Is this Belonging, or does it need its own code about institutions? Discuss at the next coding meeting.',
    },
  ],
};
