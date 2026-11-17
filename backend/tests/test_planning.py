import copy
import unittest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
from pydantic import ValidationError
from backend.main import app
from backend.style_profiles import style_profile
from backend.planning import LayoutInput, validate_layouts, partition_rooms, bounds_from_rooms, required_functions_from_rooms

IMAGE = 'data:image/png;base64,AA=='
STYLES = ['意式', '侘寂', '包豪斯']


def candidates():
    layouts = []
    for i, style in enumerate(STYLES):
        split = .35 + i * .1
        layouts.append({'title': '动线优先 ' + style, 'style': style, 'summary': '厨餐相邻，卧室在侧边',
            'circulation': {'summary': '从入户沿公共过道进入各房间，净宽待实测', 'path': [{'x': .5, 'y': .8}, {'x': .5, 'y': .2}]},
            'tradeoffs': ['减少客厅面积'], 'verification': ['核对承重墙及入口'],
            'rooms': [{'name': '客厅', 'kind': 'living', 'x': 0, 'y': 0, 'w': split, 'h': .8},
                      {'name': '卧室', 'kind': 'bedroom', 'x': split, 'y': 0, 'w': 1 - split, 'h': .8}]})
    return {'layouts': layouts}


class PlanningTests(unittest.TestCase):
    def test_multimodal_call_includes_original_reference_prompt_and_context(self):
        mock = AsyncMock(return_value=candidates())
        with TestClient(app) as client, patch('backend.main.complete', mock):
            response = client.post('/api/layouts', json={
                'image': IMAGE, 'width': 1000, 'height': 800, 'instruction': '先考虑动线，给出不同分隔',
                'styles': STYLES, 'references': [{'label': '侘寂', 'image': IMAGE}],
                'current_rooms': [{'name': '现状客厅'}],
            })
        self.assertEqual(response.status_code, 200)
        result = response.json()
        self.assertEqual(result['source'], 'model')
        self.assertEqual([p['style'] for p in result['layouts']], STYLES)
        self.assertEqual(len(set(p['id'] for p in result['layouts'])), 3)
        system, content = mock.call_args.args
        for name in STYLES:
            self.assertIn(style_profile(name)['systemPrompt'], system)
        self.assertNotIn(style_profile('北欧风')['systemPrompt'], system)
        self.assertEqual(sum(p['type'] == 'image_url' for p in content), 2)
        self.assertEqual(mock.call_args.kwargs['role'], 'vision')
        self.assertIn('先考虑动线', content[-1]['text'])
        self.assertIn('现状客厅', content[-1]['text'])
        self.assertTrue(all(p['checks']['structure_and_clearance'] == 'unverified' for p in result['layouts']))

    def test_layout_goals_use_spatial_priorities_without_style_prompts(self):
        preserve = candidates()['layouts'][0]
        preserve.pop('style')
        preserve.update(goal='preserve', retained='保留主要墙体和门窗')
        storage = {**preserve, 'goal': 'storage', 'summary': '在玄关预留柜位'}
        mock = AsyncMock(return_value={'layouts': [storage, preserve]})
        with TestClient(app) as client, patch('backend.main.complete', mock):
            response = client.post('/api/layouts', json={
                'image': IMAGE, 'width': 100, 'height': 100, 'instruction': '保持卧室独立',
                'goals': ['preserve', 'storage'], 'references': [{'image': IMAGE}],
            })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([plan['goal'] for plan in response.json()['layouts']], ['preserve', 'storage'])
        system, content = mock.call_args.args
        self.assertIn('布局参考图', system)
        self.assertNotIn(style_profile('侘寂')['systemPrompt'], system)
        self.assertIn('goal_priorities', content[-1]['text'])
        self.assertEqual(sum(part['type'] == 'image_url' for part in content), 2)

    def test_layout_goals_reject_unknown_or_duplicate_values(self):
        for goals in ([], ['侘寂'], ['storage', 'storage']):
            with self.subTest(goals=goals), self.assertRaises(ValidationError):
                LayoutInput(image=IMAGE, width=100, height=100, instruction='改善通行', goals=goals)

    def test_invalid_first_output_gets_one_targeted_model_correction(self):
        invalid = candidates(); invalid['layouts'].pop()
        mock = AsyncMock(side_effect=[invalid, candidates()])
        with TestClient(app) as client, patch('backend.main.complete', mock):
            response = client.post('/api/layouts', json={'image': IMAGE, 'width': 100, 'height': 100,
                'instruction': '动线优先', 'styles': STYLES})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(mock.await_count, 2)
        correction = mock.call_args_list[1].args[1][-1]['text']
        self.assertIn('validation_errors', correction)
        self.assertIn('previous_output', correction)

    def test_same_geometry_with_different_styles_is_rejected(self):
        data = candidates()
        for layout in data['layouts'][1:]:
            layout['rooms'] = copy.deepcopy(data['layouts'][0]['rooms'])
        with self.assertRaises(ValueError):
            validate_layouts(data, STYLES)

    def test_overlap_or_outside_is_rejected_instead_of_clipped(self):
        for key, value in [('x', .9), ('w', 1)]:
            data = candidates()
            data['layouts'][0]['rooms'][0][key] = value
            with self.subTest(key=key), self.assertRaises(ValidationError):
                validate_layouts(data, STYLES)

    def test_missing_style_and_invalid_coordinate_fail_without_demo(self):
        data = candidates(); data['layouts'].pop()
        with TestClient(app) as client, patch('backend.main.complete', AsyncMock(return_value=data)):
            response = client.post('/api/layouts', json={'image': IMAGE, 'width': 100, 'height': 100,
                'instruction': '三种风格', 'styles': STYLES})
        self.assertEqual(response.status_code, 502)
        self.assertNotIn('layouts', response.json())

    def test_model_partition_is_materialized_inside_original_bounds_without_overlap(self):
        bounds = {'x': .3, 'y': .1, 'w': .4, 'h': .8}
        tree = {'axis':'x', 'split':.4, 'children':[
            {'name':'客厅','kind':'living','axis':None},
            {'axis':'y','split':.5,'children':[{'name':'厨房','kind':'kitchen'}, {'name':'卧室','kind':'bedroom'}]},
        ]}
        rooms = partition_rooms(tree, bounds)
        self.assertAlmostEqual(sum(r['w'] * r['h'] for r in rooms), .32)
        self.assertAlmostEqual(rooms[1]['x'], .46)
        self.assertAlmostEqual(rooms[2]['y'], .5)
        for key, value in bounds.items():
            self.assertAlmostEqual(bounds_from_rooms(rooms)[key], value)
        data = candidates()
        for i, layout in enumerate(data['layouts']):
            layout.pop('rooms')
            layout['bounds'] = {'x':0,'y':0,'w':1,'h':1}
            layout['partition'] = copy.deepcopy(tree)
            layout['partition']['split'] = .35 + .1 * i
        layouts = validate_layouts(data, STYLES, bounds)
        self.assertAlmostEqual(layouts[0]['rooms'][0]['x'], .3)
        self.assertAlmostEqual(layouts[0]['rooms'][0]['w'], .14)

    def test_invalid_partition_depth_ratio_or_leaf_extent_is_rejected(self):
        bounds = {'x':0,'y':0,'w':1,'h':1}
        for node in [None, {'axis':'x','split':1,'children':[{},{}]},
                     {'axis':'x','split':.5,'children':[{'name':'a'}]}]:
            with self.subTest(node=node), self.assertRaises(ValueError):
                partition_rooms(node, bounds)

    def test_original_kitchen_and_bath_cannot_disappear_into_description(self):
        required = required_functions_from_rooms([{'name':'厨房'}, {'name':'卫生间'}])
        self.assertEqual(required, ['bath','kitchen'])
        with self.assertRaises(ValueError):
            validate_layouts(candidates(), STYLES, required_functions=required)

    def test_multiple_ordered_zones_use_explicit_weights_without_overlap(self):
        rooms = partition_rooms({'axis':'x', 'weights':[2,1,1], 'children':[
            {'name':'客厅'}, {'name':'厨房'}, {'name':'卫生间'}]}, {'x':0,'y':0,'w':1,'h':1})
        self.assertEqual([r['w'] for r in rooms], [.5,.25,.25])
        self.assertEqual([r['x'] for r in rooms], [0,.5,.75])

    def test_combined_kitchen_dining_zone_retains_kitchen_function(self):
        data = candidates()
        for layout in data['layouts']:
            layout['rooms'][0].update(name='餐厨一体区', kind='dining')
            layout['rooms'][1].update(name='卫生间', kind='bath')
        self.assertEqual(len(validate_layouts(data, STYLES, required_functions=['kitchen','bath'])), 3)

    def test_input_requires_real_instruction_and_distinct_styles(self):
        for patch_value in [{'instruction': ' '}, {'styles': ['意式', '意式']}, {'styles': ['意式', '现代意式']}, {'styles': ['a','b','c','d']}]:
            with self.subTest(patch_value=patch_value), self.assertRaises(ValidationError):
                LayoutInput.model_validate({'image': IMAGE, 'width': 100, 'height': 100,
                    'instruction': '动线优先', 'styles': STYLES, **patch_value})
