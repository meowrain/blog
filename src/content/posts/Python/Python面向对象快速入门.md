---
title: Python面向对象快速入门
published: 2026-01-19T22:53:40
description: '一篇关于 Python 面向对象编程（OOP）的快速入门指南，涵盖类、对象、封装、继承和多态等核心概念。'
image: ''
draft: false 
lang: ''
category: Python
tags: 
  - Python
  - OOP
  - 编程基础
---

面向对象编程（Object-Oriented Programming，简称 OOP）是一种程序设计思想。在 Python 中，一切皆对象。掌握 OOP 是进阶 Python 编程的关键一步。

本文将带你快速理解 Python 面向对象的核心概念。

## 1. 类 (Class) 与 对象 (Object)

**类**是创建对象的蓝图（模板），**对象**是类的具体实例。

比喻：
- **类**：汽车的设计图纸。
- **对象**：根据图纸制造出来的具体的一辆辆汽车（如你的宝马、他的奔驰）。

### 定义类与创建对象

```python
# 定义一个类
class Dog:
    pass

# 创建对象（实例化）
dog1 = Dog()
dog2 = Dog()

print(dog1)  # <__main__.Dog object at ...>
print(dog1 == dog2) # False，它们是两个不同的对象
```

## 2. 构造方法与属性

在类中，我们可以定义属性（变量）来描述对象的特征。

### `__init__` 方法

`__init__` 是一个特殊方法（构造方法），在创建对象时自动调用，用于初始化对象的属性。

- `self`：代表类的实例（对象）本身。在定义类的方法时，第一个参数通常是 `self`。

```python
class Cat:
    def __init__(self, name, age):
        self.name = name  # 实例属性
        self.age = age    # 实例属性

# 创建对象时传入参数
tom = Cat("Tom", 3)
jerry = Cat("Jerry", 2)

print(f"{tom.name} is {tom.age} years old.")
# 输出: Tom is 3 years old.
```

## 3. 方法 (Methods)

方法就是定义在类内部的函数，用来描述对象的行为。

```python
class Person:
    def __init__(self, name):
        self.name = name

    def say_hello(self):
        print(f"Hello, my name is {self.name}.")

p = Person("Alice")
p.say_hello()
# 输出: Hello, my name is Alice.
```

## 4. 封装 (Encapsulation)

封装是指将数据（属性）和操作数据的方法绑定在一起，并隐藏对象的内部实现细节。

在 Python 中，通过在属性名前加双下划线 `__` 将其变为私有属性（Private），外部无法直接访问。

```python
class BankAccount:
    def __init__(self, balance):
        self.__balance = balance  # 私有属性

    def deposit(self, amount):
        if amount > 0:
            self.__balance += amount
            print(f"Deposited {amount}")

    def get_balance(self):
        return self.__balance

account = BankAccount(100)
account.deposit(50)
print(account.get_balance()) # 输出: 150

# print(account.__balance) # 报错！无法直接访问私有属性
```

## 5. 继承 (Inheritance)

继承允许我们创建一个新类（子类），从现有的类（父类）继承属性和方法。这提高了代码的复用性。

```python
# 父类
class Animal:
    def speak(self):
        print("Animal speaks")

# 子类继承父类
class Dog(Animal):
    def speak(self):
        print("Woof!")  # 重写父类方法

class Cat(Animal):
    pass 

dog = Dog()
dog.speak() # 输出: Woof!

cat = Cat()
cat.speak() # 输出: Animal speaks (直接继承父类方法)
```

### `super()` 函数

子类可以使用 `super()` 调用父类的方法，常用于扩展父类的 `__init__` 方法。

```python
class Bird(Animal):
    def __init__(self, name, can_fly):
        super().__init__() # 调用父类构造方法（如果有的话）
        self.name = name
        self.can_fly = can_fly
```

## 6. 多态 (Polymorphism)

多态指“多种形态”。不同的子类对象调用相同的方法，产生不同的行为。

上面的 `Dog` 和 `Cat` 都继承自 `Animal` 并调用 `speak()` 方法，但表现不同，这就是多态。

```python
def animal_sound(animal):
    animal.speak()

dog = Dog()
cat = Cat()

animal_sound(dog) # 输出: Woof!
animal_sound(cat) # 输出: Animal speaks
```

## 总结

- **类**是模板，**对象**是实例。
- **属性**描述特征，**方法**描述行为。
- **封装**保护数据安全。
- **继承**实现代码复用。
- **多态**提供灵活的接口。

掌握这些概念，你就迈入了 Python 面向对象编程的大门！
